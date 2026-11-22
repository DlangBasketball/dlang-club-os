-- ============================================================================
-- Selection roster suite (migration 20250420102900_selection_roster.sql)
--
--   A. Registration fix: enrolment writes the confirmed programme
--      registration (partial unique index); the backfill repairs enrolled
--      applications that lost it (the old ON CONFLICT bug); health notice.
--   B. Tournaments: admin set-up, coverage count must match the package
--      unless overridden with a reason; RLS + cross-tenant denial.
--   C. Staff add: one live enrolment per player and programme; fee
--      arrangement snapshot; monthly schedule (3000 / 300 -> 10, 3100 / 300
--      -> 10 x 300 + 100, first due date); snapshot unchanged when the
--      package price changes.
--   D. Payments: record 300 on 3000 -> balance 2700, partial; void keeps
--      history; arrangement change after payment goes through a debit note.
--   E. Roster / athlete card per role: admin, finance (money), coach of the
--      programme (no amounts), coach of another programme, guardian (own
--      child with money), other family, other org.
--   F. Withdraw: keeps application, invoice, payments, plan; balance at
--      withdrawal; per-tournament withdrawal; move season only without
--      payments; jersey number unique per team.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3 =
-- coach …011, guardian …f4 of family …061 / athlete …071; family …062 =
-- athletes …072, …073). Org B …0002 (seed_tenants.sql).
-- SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema sr;
grant usage on schema sr to authenticated, anon, service_role;
create table sr.ctx (k text primary key, v text);
grant all on sr.ctx to authenticated, anon, service_role;

create function sr.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function sr.put(p_k text, p_v text) returns void language sql as $$
  insert into sr.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function sr.get(p_k text) returns text language sql stable as $$ select v from sr.ctx where k = p_k $$;
create function sr.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
grant execute on all functions in schema sr to authenticated, anon, service_role;

-- Fixtures ---------------------------------------------------------------------
-- Org A: selection programme "Roster season 1" (+ season 2), U14 / U16 with
-- teams, packages with tournament counts and monthly amounts, 3 tournaments.
insert into public.teams (id, org_id, name, sport) values
  ('00000000-0000-0000-0000-0000000004a1', '00000000-0000-0000-0000-000000000001', 'Synthetic Roster U14', 'basketball'),
  ('00000000-0000-0000-0000-0000000004a2', '00000000-0000-0000-0000-000000000001', 'Synthetic Roster U16', 'basketball');
insert into public.programs (id, org_id, slug, name, kind, price_chf, is_public, is_active, status, selection_enabled,
                             requires_approval, season_year, registration_closes_at, series)
values ('00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-000000000001', 'roster-s1', 'Roster season 1', 'selection', 0,
        true, true, 'published', true, true, 2026, now() - interval '1 day', 'roster'),
       ('00000000-0000-0000-0000-0000000004b2', '00000000-0000-0000-0000-000000000001', 'roster-s2', 'Roster season 2', 'selection', 0,
        false, true, 'published', true, true, 2027, null, 'roster');
insert into public.program_divisions (id, org_id, program_id, name, min_birth_year, team_id, sort) values
  ('00000000-0000-0000-0000-0000000004c1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b1', 'U14', 2013, '00000000-0000-0000-0000-0000000004a1', 1),
  ('00000000-0000-0000-0000-0000000004c2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b1', 'U16', 2010, '00000000-0000-0000-0000-0000000004a2', 2),
  ('00000000-0000-0000-0000-0000000004c3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b2', 'All', null, null, 1);
insert into public.program_packages (id, org_id, program_id, name, price, allowed_counts, tournament_count, monthly_amount) values
  ('00000000-0000-0000-0000-0000000004d1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b1', '1 tournament', 1500, '{1}', 1, 300),
  ('00000000-0000-0000-0000-0000000004d2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b1', '2 tournaments', 3000, '{1}', 2, 300),
  ('00000000-0000-0000-0000-0000000004d3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b1', '3 tournaments', 4500, '{1}', 3, 450),
  ('00000000-0000-0000-0000-0000000004d4', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b2', 'Season 2', 2000, '{1}', null, 200);
insert into public.program_coaches (org_id, program_id, coach_id, role)
values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-000000000011', 'head');

-- A second coach (not assigned) and a guardian of family …062.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000004e1', 'roster-coach2@example.test'),
  ('00000000-0000-0000-0000-0000000004e2', 'roster-guardian2@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001'
 where id in ('00000000-0000-0000-0000-0000000004e1', '00000000-0000-0000-0000-0000000004e2');
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004e1', 'coach'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004e2', 'parent');
insert into public.coaches (id, org_id, display_name, profile_id) values
  ('00000000-0000-0000-0000-0000000004e3', '00000000-0000-0000-0000-000000000001', 'Synthetic Coach Unassigned', '00000000-0000-0000-0000-0000000004e1');
insert into public.family_members (family_id, profile_id, relation) values
  ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-0000000004e2', 'guardian');

-- Org B: admin and a selection programme with a tournament.
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000004f1', 'roster-admin-b@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000004f1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000004f1', 'admin');
insert into public.programs (id, org_id, slug, name, kind, price_chf, is_public, is_active, status, selection_enabled)
values ('b0000000-0000-0000-0000-0000000004f2', '10000000-0000-0000-0000-000000000002', 'b-roster', 'B roster', 'selection', 0, false, true, 'published', true);
insert into public.program_tournaments (id, org_id, program_id, name)
values ('b0000000-0000-0000-0000-0000000004f3', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000004f2', 'B cup');

-- ===========================================================================
-- A. Registration fix + backfill + health
-- ===========================================================================
do $$
declare v jsonb; n int;
begin
  -- Reproduce the old broken state: an enrolled application without its
  -- registration (what the swallowed ON CONFLICT error left behind).
  insert into public.program_applications (id, org_id, program_id, division_id, package_id, athlete_id, family_id, status, source, accepted_at, enrolled_at)
  values ('00000000-0000-0000-0000-0000000004a9', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b1',
          '00000000-0000-0000-0000-0000000004c2', '00000000-0000-0000-0000-0000000004d2', '00000000-0000-0000-0000-000000000073',
          '00000000-0000-0000-0000-000000000062', 'enrolled', 'admin', now(), now());
  perform sr.ok(not exists (select 1 from public.registrations where athlete_id = '00000000-0000-0000-0000-000000000073'
                             and program_id = '00000000-0000-0000-0000-0000000004b1'), 'broken state: enrolled, no registration');
end $$;

do $$
declare v text; r jsonb;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
begin
  v := sr.run_as(admin_a, $q$select jsonb_array_length(public.selection_roster_health('00000000-0000-0000-0000-0000000004b1')->'missing_registrations')::text$q$);
  perform sr.ok(v = 'OK:1', 'health notice lists the enrolled player without registration (' || v || ')');
  v := sr.run_as('00000000-0000-0000-0000-0000000000f4', $q$select public.selection_roster_health(null)::text$q$);
  perform sr.ok(v like 'ERR:%NOT_AUTHORIZED%', 'health notice is staff only (' || left(v, 50) || ')');
  v := sr.run_as(admin_a, $q$select public.selection_backfill_registrations()::text$q$);
  perform sr.ok(v like 'ERR:%', 'backfill is service-role only (' || left(v, 50) || ')');
  r := public.selection_backfill_registrations();
  perform sr.ok((r->>'confirmed')::int = 1 and (r->>'failed')::int = 0, 'backfill confirms the missing registration (' || r::text || ')');
  perform sr.ok(exists (select 1 from public.registrations where athlete_id = '00000000-0000-0000-0000-000000000073'
                         and program_id = '00000000-0000-0000-0000-0000000004b1' and status = 'confirmed' and camp_edition_id is null),
                'registration confirmed (programme registration window already closed)');
  r := public.selection_backfill_registrations();
  perform sr.ok((r->>'confirmed')::int = 0, 'backfill is idempotent (' || r::text || ')');
  perform sr.ok((select count(*) = 1 from public.registrations where athlete_id = '00000000-0000-0000-0000-000000000073'
                  and program_id = '00000000-0000-0000-0000-0000000004b1'), 'one registration only');
  -- A cancelled registration is re-confirmed by the fixed upsert (conflict on the partial index).
  update public.registrations set status = 'cancelled' where athlete_id = '00000000-0000-0000-0000-000000000073'
     and program_id = '00000000-0000-0000-0000-0000000004b1';
  perform sr.ok(public.selection_ensure_registration('00000000-0000-0000-0000-0000000004a9'), 'ensure_registration upserts on the partial index');
  perform sr.ok((select status::text = 'confirmed' from public.registrations where athlete_id = '00000000-0000-0000-0000-000000000073'
                  and program_id = '00000000-0000-0000-0000-0000000004b1'), 'cancelled registration re-confirmed');
  v := sr.run_as(admin_a, $q$select jsonb_array_length(public.selection_roster_health('00000000-0000-0000-0000-0000000004b1')->'missing_registrations')::text$q$);
  perform sr.ok(v = 'OK:0', 'health notice clear after the fix (' || v || ')');
  perform sr.ok(not exists (select 1 from pg_proc p where p.proname = 'selection_enroll_internal'
                              and pg_get_functiondef(p.oid) ilike '%on conflict (athlete_id, program_id) do%'),
                'no ON CONFLICT on registrations without the partial-index predicate');
  -- Clean up the fixture application (withdraw path keeps rows; here a plain status reset).
  update public.program_applications set status = 'withdrawn', withdrawn_at = now() where id = '00000000-0000-0000-0000-0000000004a9';
  update public.registrations set status = 'cancelled' where athlete_id = '00000000-0000-0000-0000-000000000073'
     and program_id = '00000000-0000-0000-0000-0000000004b1';
end $$;

-- ===========================================================================
-- B. Tournaments
-- ===========================================================================
do $$
declare v text;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  coach1 uuid := '00000000-0000-0000-0000-0000000000f3';
  guardian uuid := '00000000-0000-0000-0000-0000000000f4';
  admin_b uuid := 'b0000000-0000-0000-0000-0000000004f1';
begin
  v := sr.run_as(admin_a, $q$insert into public.program_tournaments (org_id, program_id, name, starts_on, ends_on, location, sort)
       values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b1', 'Stage 1', '2026-10-10', '2026-10-12', 'Synthetic City', 1)
       returning id$q$);
  perform sr.ok(v like 'OK:%', 'admin adds a tournament (' || left(v, 50) || ')');
  perform sr.put('t1', substr(v, 4));
  v := sr.run_as(admin_a, $q$insert into public.program_tournaments (org_id, program_id, name, sort)
       values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b1', 'Stage 2', 2) returning id$q$);
  perform sr.put('t2', substr(v, 4));
  v := sr.run_as(admin_a, $q$insert into public.program_tournaments (org_id, program_id, name, sort)
       values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b1', 'Stage 3', 3) returning id$q$);
  perform sr.put('t3', substr(v, 4));
  v := sr.run_as(admin_a, $q$insert into public.program_tournaments (org_id, program_id, name, starts_on, ends_on)
       values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b1', 'Bad dates', '2026-10-12', '2026-10-10') returning id$q$);
  perform sr.ok(v like 'ERR:%', 'tournament end before start refused');
  v := sr.run_as(finance_a, $q$insert into public.program_tournaments (org_id, program_id, name)
       values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b1', 'Finance stage') returning id$q$);
  perform sr.ok(v like 'ERR:%', 'finance cannot change tournaments (' || left(v, 50) || ')');
  v := sr.run_as(coach1, $q$insert into public.program_tournaments (org_id, program_id, name)
       values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b1', 'Coach stage') returning id$q$);
  perform sr.ok(v like 'ERR:%', 'a coach cannot change tournaments');
  v := sr.run_as(guardian, $q$select count(*)::text from public.program_tournaments where program_id = '00000000-0000-0000-0000-0000000004b1'$q$);
  perform sr.ok(v = 'OK:3', 'club members read the tournaments (' || v || ')');
  v := sr.run_as(admin_b, $q$select count(*)::text from public.program_tournaments where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform sr.ok(v = 'OK:0', 'org B sees no org A tournament (' || v || ')');
  v := sr.run_as(admin_a, $q$select count(*)::text from public.program_tournaments where id = 'b0000000-0000-0000-0000-0000000004f3'$q$);
  perform sr.ok(v = 'OK:0', 'org A sees no org B tournament (' || v || ')');
  v := sr.run_as(admin_b, $q$insert into public.program_tournaments (org_id, program_id, name)
       values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000004b1', 'Cross') returning id$q$);
  perform sr.ok(v like 'ERR:%', 'org B cannot add a tournament to an org A programme (' || left(v, 60) || ')');
  v := sr.run_as(admin_b, format($q$with u as (update public.program_tournaments set name = 'Hijack' where id = %L returning 1) select count(*)::text from u$q$, sr.get('t1')));
  perform sr.ok(v = 'OK:0', 'org B cannot rename an org A tournament (' || v || ')');
  v := sr.run_as(admin_b, format($q$with u as (delete from public.program_tournaments where id = %L returning 1) select count(*)::text from u$q$, sr.get('t1')));
  perform sr.ok(v = 'OK:0', 'org B cannot delete an org A tournament (' || v || ')');
end $$;

-- ===========================================================================
-- C. Staff add, duplicates, arrangement snapshot
-- ===========================================================================
do $$
declare v text; r record;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  coach1 uuid := '00000000-0000-0000-0000-0000000000f3';
  guardian uuid := '00000000-0000-0000-0000-0000000000f4';
  admin_b uuid := 'b0000000-0000-0000-0000-0000000004f1';
begin
  -- Pure schedule helper.
  perform sr.ok((select count(*) = 10 and sum(amount) = 3000 and max(amount) = 300 from public.selection_arrangement_schedule(3000, 'monthly', 300, '2026-09-15')),
                'schedule 3000 / 300 -> 10 x 300');
  perform sr.ok((select count(*) = 5 from public.selection_arrangement_schedule(1500, 'monthly', 300, '2026-09-15')), 'schedule 1500 / 300 -> 5');
  perform sr.ok((select count(*) = 10 from public.selection_arrangement_schedule(4500, 'monthly', 450, '2026-09-15')), 'schedule 4500 / 450 -> 10');
  perform sr.ok((select count(*) = 11 and sum(amount) = 3100 and (array_agg(amount order by seq))[11] = 100
                   from public.selection_arrangement_schedule(3100, 'monthly', 300, '2026-09-15')), 'schedule 3100 / 300 -> 10 x 300 + 100');
  perform sr.ok((select min(due_on) = '2026-01-31' and (array_agg(due_on order by seq))[2] = '2026-02-28'
                   from public.selection_arrangement_schedule(1500, 'monthly', 300, '2026-01-31')), 'monthly dates from the first due date, clamped to month ends');
  perform sr.ok((select count(*) = 1 and min(due_on) = '2026-09-01' from public.selection_arrangement_schedule(3000, 'full', null, '2026-09-01')), 'pay in full: one amount on the first due date');

  v := sr.run_as(finance_a, format($q$select public.selection_staff_add('00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-000000000071',
        '00000000-0000-0000-0000-0000000004c1', '00000000-0000-0000-0000-0000000004d2', array[%L, %L]::uuid[], 'monthly', 300, current_date)::text$q$,
        sr.get('t1'), sr.get('t2')));
  perform sr.ok(v like 'ERR:%NOT_AUTHORIZED%', 'finance cannot add players (' || left(v, 50) || ')');
  v := sr.run_as(coach1, $q$select public.selection_staff_add('00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-000000000071',
        '00000000-0000-0000-0000-0000000004c1', '00000000-0000-0000-0000-0000000004d2')::text$q$);
  perform sr.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a coach cannot add players');
  v := sr.run_as(admin_b, $q$select public.selection_staff_add('00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-000000000071',
        '00000000-0000-0000-0000-0000000004c1', '00000000-0000-0000-0000-0000000004d2')::text$q$);
  perform sr.ok(v like 'ERR:%', 'org B admin cannot add to an org A programme (' || left(v, 50) || ')');
  v := sr.run_as(admin_a, format($q$select public.selection_staff_add('00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-000000000071',
        '00000000-0000-0000-0000-0000000004c1', '00000000-0000-0000-0000-0000000004d2', array[%L]::uuid[], 'monthly', 300, current_date)::text$q$,
        sr.get('t1')));
  perform sr.ok(v like 'ERR:%TOURNAMENT_COUNT_MISMATCH%', '2-tournament package needs 2 tournaments (' || left(v, 60) || ')');
  perform sr.ok(not exists (select 1 from public.program_applications where athlete_id = '00000000-0000-0000-0000-000000000071'
                             and program_id = '00000000-0000-0000-0000-0000000004b1'), 'failed add leaves nothing behind');
  v := sr.run_as(admin_a, format($q$select public.selection_staff_add('00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-000000000071',
        '00000000-0000-0000-0000-0000000004c1', '00000000-0000-0000-0000-0000000004d2', array[%L, %L]::uuid[], 'monthly', 300, current_date)->>'application_id'$q$,
        sr.get('t1'), sr.get('t2')));
  perform sr.ok(v like 'OK:%' and v <> 'OK:<null>', 'admin adds a club player: 2 tournaments, monthly 300 (' || left(v, 50) || ')');
  perform sr.put('app1', substr(v, 4));
  select a.*, i.total_chf as inv_total into r from public.program_applications a join public.invoices i on i.id = a.invoice_id where a.id = sr.get('app1')::uuid;
  perform sr.ok(r.status = 'enrolled' and r.source = 'admin' and r.agreed_fee = 3000 and r.agreed_currency = 'CHF' and r.arrangement_kind = 'monthly'
                and r.monthly_amount = 300 and r.arrangement_installments = 10 and r.first_due_on = current_date and r.tournaments_covered_count = 2
                and r.agreed_by = admin_a and r.inv_total = 3000, 'arrangement snapshot stored (fee, currency, kind, 10 x 300, first due, covered 2)');
  perform sr.ok((select count(*) = 10 and sum(i.amount) = 3000 and min(i.due_date) = current_date
                   from public.payment_plan_installments i join public.payment_plans p on p.id = i.plan_id
                  where p.invoice_id = r.invoice_id and p.status = 'active'), 'invoice + plan: 10 instalments of 300 from the first due date');
  perform sr.ok(exists (select 1 from public.registrations where athlete_id = '00000000-0000-0000-0000-000000000071'
                         and program_id = '00000000-0000-0000-0000-0000000004b1' and status = 'confirmed'), 'staff enrolment writes the registration');
  perform sr.ok(exists (select 1 from public.team_memberships where team_id = '00000000-0000-0000-0000-0000000004a1'
                         and athlete_id = '00000000-0000-0000-0000-000000000071' and status = 'active'), 'and the division team roster');
  perform sr.ok((select count(*) = 2 from public.application_tournaments where application_id = sr.get('app1')::uuid and status = 'covered'),
                'two tournaments covered');

  -- Duplicates: one live enrolment per player and programme (DB + friendly code).
  v := sr.run_as(admin_a, $q$select public.selection_staff_add('00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-000000000071',
        '00000000-0000-0000-0000-0000000004c1', '00000000-0000-0000-0000-0000000004d1', '{}'::uuid[], 'full', null, current_date, 'enrolled', 'synthetic override')::text$q$);
  perform sr.ok(v like 'ERR:%ALREADY_ENROLLED%', 'second live enrolment refused (' || left(v, 50) || ')');
  begin
    insert into public.program_applications (org_id, program_id, package_id, athlete_id, family_id, status, source)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-0000000004d1',
            '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000061', 'accepted', 'admin');
    perform sr.ok(false, 'unique index blocks a duplicate live enrolment');
  exception when unique_violation then
    perform sr.ok(true, 'unique index blocks a duplicate live enrolment');
  end;

  -- Second player (family …062), pay in full 1 tournament with an override reason for 0 tournaments.
  v := sr.run_as(admin_a, $q$select public.selection_staff_add('00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-000000000072',
        '00000000-0000-0000-0000-0000000004c2', '00000000-0000-0000-0000-0000000004d1', '{}'::uuid[], 'full', null, current_date - 20, 'enrolled',
        'Tournament dates not published yet')->>'application_id'$q$);
  perform sr.ok(v like 'OK:%' and v <> 'OK:<null>', 'override with reason: no tournament assigned yet (' || left(v, 50) || ')');
  perform sr.put('app2', substr(v, 4));
  perform sr.ok((select tournament_override_reason = 'Tournament dates not published yet' and agreed_fee = 1500 and arrangement_kind = 'full'
                         and arrangement_installments = 1 from public.program_applications where id = sr.get('app2')::uuid),
                'override reason and pay-in-full snapshot stored');

  -- Package price change never changes the snapshot.
  update public.program_packages set price = 3600 where id = '00000000-0000-0000-0000-0000000004d2';
  perform sr.ok((select agreed_fee = 3000 from public.program_applications where id = sr.get('app1')::uuid)
                and (select total_chf = 3000 from public.invoices where id = (select invoice_id from public.program_applications where id = sr.get('app1')::uuid)),
                'package price change leaves the agreed fee and invoice unchanged');
  update public.program_packages set price = 3000 where id = '00000000-0000-0000-0000-0000000004d2';

  -- Tournaments via the RPC: cross-programme tournament refused; count mismatch needs a reason.
  v := sr.run_as(admin_a, format($q$select public.selection_set_tournaments(%L, array['b0000000-0000-0000-0000-0000000004f3']::uuid[], 'x')::text$q$, sr.get('app1')));
  perform sr.ok(v like 'ERR:%TOURNAMENT_NOT_FOUND%', 'another club''s tournament refused (' || left(v, 60) || ')');
  v := sr.run_as(admin_a, format($q$select public.selection_set_tournaments(%L, array[%L, %L, %L]::uuid[])::text$q$, sr.get('app1'), sr.get('t1'), sr.get('t2'), sr.get('t3')));
  perform sr.ok(v like 'ERR:%TOURNAMENT_COUNT_MISMATCH%', '3 tournaments on a 2-tournament arrangement needs a reason');
  v := sr.run_as(admin_a, format($q$select (public.selection_set_tournaments(%L, array[%L, %L]::uuid[])->>'covered')$q$, sr.get('app1'), sr.get('t1'), sr.get('t3')));
  perform sr.ok(v = 'OK:2', 'swap a tournament (' || v || ')');
  perform sr.ok((select count(*) = 2 and bool_and(tournament_id in (sr.get('t1')::uuid, sr.get('t3')::uuid)) from public.application_tournaments
                  where application_id = sr.get('app1')::uuid and status = 'covered'), 'coverage replaced');
  v := sr.run_as(finance_a, format($q$select public.selection_set_tournaments(%L, array[%L, %L]::uuid[])::text$q$, sr.get('app1'), sr.get('t1'), sr.get('t2')));
  perform sr.ok(v like 'ERR:%APPLICATION_NOT_FOUND%', 'finance cannot edit tournaments');
  v := sr.run_as(admin_a, format($q$insert into public.application_tournaments (org_id, application_id, tournament_id) values ('00000000-0000-0000-0000-000000000001', %L, %L) returning id$q$, sr.get('app2'), sr.get('t2')));
  perform sr.ok(v like 'ERR:%', 'no direct client writes of coverage');
end $$;

-- ===========================================================================
-- D. Payments, void, arrangement change after payment
-- ===========================================================================
do $$
declare v text; v_inv uuid; v_pay uuid; r record;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  guardian uuid := '00000000-0000-0000-0000-0000000000f4';
  coach1 uuid := '00000000-0000-0000-0000-0000000000f3';
begin
  v_inv := (select invoice_id from public.program_applications where id = sr.get('app1')::uuid);
  perform sr.put('inv1', v_inv::text);
  v := sr.run_as(coach1, format($q$select public.record_offline_payment(%L, 300, 'bank_transfer')::text$q$, v_inv));
  perform sr.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a coach cannot record payments');
  v := sr.run_as(guardian, format($q$select public.record_offline_payment(%L, 300, 'bank_transfer')::text$q$, v_inv));
  perform sr.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a guardian cannot record offline payments');
  v := sr.run_as(finance_a, format($q$select public.record_offline_payment(%L, 300, 'bank_transfer', current_date, 'SYN-REF-1', 'first month')->>'payment_id'$q$, v_inv));
  perform sr.ok(v like 'OK:%' and v <> 'OK:<null>', 'finance records 300 (' || left(v, 50) || ')');
  perform sr.put('pay1', substr(v, 4));
  select * into r from public.selection_invoice_summary(v_inv);
  perform sr.ok(r.amount_due = 3000 and r.received = 300 and r.balance = 2700 and r.payment_status = 'partial',
                'record payment -> received 300, balance 2700, partially paid (' || r.balance || ' ' || r.payment_status || ')');
  perform sr.ok(r.next_due_on = (current_date + interval '1 month')::date or r.next_due_on > current_date, 'next due date is the second instalment');
  perform sr.ok(r.overdue_amount = 0, 'nothing overdue yet');

  -- Overdue: an instalment in the past without payment.
  update public.payment_plan_installments set due_date = current_date - 40 where invoice_id = v_inv and seq = 1;
  update public.payment_plan_installments set due_date = current_date - 10 where invoice_id = v_inv and seq = 2;
  select * into r from public.selection_invoice_summary(v_inv);
  perform sr.ok(r.overdue_amount = 300 and r.next_due_on = current_date - 10, 'second instalment overdue: 300 flagged separately (' || r.overdue_amount || ')');
  update public.payment_plan_installments set due_date = current_date where invoice_id = v_inv and seq = 1;
  update public.payment_plan_installments set due_date = (current_date + interval '1 month')::date where invoice_id = v_inv and seq = 2;

  -- Arrangement change after a payment: invoice kept, debit note with a reason, plan rebuilt.
  v := sr.run_as(finance_a, format($q$select public.selection_set_arrangement(%L, 'monthly', '00000000-0000-0000-0000-0000000004d3', 450, current_date)::text$q$, sr.get('app1')));
  perform sr.ok(v like 'ERR:%REASON_REQUIRED%', 'arrangement change after payment needs a reason (' || left(v, 60) || ')');
  v := sr.run_as(finance_a, format($q$select public.selection_set_arrangement(%L, 'monthly', '00000000-0000-0000-0000-0000000004d3', 450, current_date, 'Third tournament added')->>'invoice_id'$q$, sr.get('app1')));
  perform sr.ok(v = 'OK:' || v_inv::text, 'paid invoice kept (' || left(v, 50) || ')');
  perform sr.ok(exists (select 1 from public.invoice_adjustments where invoice_id = v_inv and kind = 'debit_note' and amount = 1500
                          and reason = 'Third tournament added' and voided_at is null), 'debit note of 1500 with the reason');
  select * into r from public.selection_invoice_summary(v_inv);
  perform sr.ok(r.amount_due = 4500 and r.received = 300 and r.balance = 4200, 'amount due 4500, received 300, balance 4200');
  perform sr.ok((select count(*) = 10 and sum(i.amount) = 4500 from public.payment_plan_installments i join public.payment_plans p on p.id = i.plan_id
                  where p.invoice_id = v_inv and p.status = 'active'), 'new plan 10 x 450 on the amount due');
  perform sr.ok((select count(*) >= 1 from public.payment_plans where invoice_id = v_inv and status = 'cancelled'), 'old plan kept as cancelled (history)');
  perform sr.ok((select agreed_fee = 4500 and monthly_amount = 450 and tournaments_covered_count = 3 and package_id = '00000000-0000-0000-0000-0000000004d3'
                  from public.program_applications where id = sr.get('app1')::uuid), 'snapshot updated to the new arrangement');

  -- Before any payment: clean re-issue (old invoice cancelled and kept).
  v_inv := (select invoice_id from public.program_applications where id = sr.get('app2')::uuid);
  v := sr.run_as(finance_a, format($q$select public.selection_set_arrangement(%L, 'monthly', '00000000-0000-0000-0000-0000000004d1', 300, current_date)->>'invoice_id'$q$, sr.get('app2')));
  perform sr.ok(v like 'OK:%' and v <> 'OK:' || v_inv::text, 'unpaid invoice re-issued (' || left(v, 50) || ')');
  perform sr.ok((select status::text = 'cancelled' from public.invoices where id = v_inv), 'old unpaid invoice cancelled, kept');
  perform sr.ok((select count(*) = 5 from public.payment_plan_installments where invoice_id = substr(v, 4)::uuid), '1500 / 300 -> 5 instalments');
  v := sr.run_as(guardian, format($q$select public.selection_set_arrangement(%L, 'full')::text$q$, sr.get('app2')));
  perform sr.ok(v like 'ERR:%APPLICATION_NOT_FOUND%', 'a guardian cannot change the fee arrangement');
  v := sr.run_as(finance_a, format($q$select public.selection_set_arrangement(%L, 'monthly', null, 10, current_date)::text$q$, sr.get('app2')));
  perform sr.ok(v like 'ERR:%TOO_MANY_INSTALLMENTS%', 'more than 24 instalments refused (' || left(v, 60) || ')');

  -- Void a payment (existing workflow): history kept, balance back.
  v := sr.run_as(finance_a, format($q$select public.void_payment(%L, 'Recorded twice')->>'reversal_id'$q$, sr.get('pay1')));
  perform sr.ok(v like 'OK:%' and v <> 'OK:<null>', 'payment voided with a reason (' || left(v, 50) || ')');
  select * into r from public.selection_invoice_summary(sr.get('inv1')::uuid);
  perform sr.ok(r.received = 0 and r.balance = 4500 and r.payment_status = 'unpaid', 'after void: received 0, unpaid');
  perform sr.ok((select count(*) = 2 from public.payments where invoice_id = sr.get('inv1')::uuid), 'original and reversal rows kept');
  v := sr.run_as(finance_a, format($q$select public.record_offline_payment(%L, 300, 'twint', current_date)->>'payment_id'$q$, sr.get('inv1')));
  perform sr.put('pay2', substr(v, 4));
end $$;

-- ===========================================================================
-- E. Roster and athlete card per role
-- ===========================================================================
do $$
declare v text;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  coach1 uuid := '00000000-0000-0000-0000-0000000000f3';
  coach2 uuid := '00000000-0000-0000-0000-0000000004e1';
  guardian uuid := '00000000-0000-0000-0000-0000000000f4';
  guardian2 uuid := '00000000-0000-0000-0000-0000000004e2';
  admin_b uuid := 'b0000000-0000-0000-0000-0000000004f1';
  q text := $q$select string_agg(coalesce(balance::text, 'x') || '/' || coalesce(payment_status, 'x'), ',' order by last_name, first_name)
                 from public.selection_roster('00000000-0000-0000-0000-0000000004b1') where status <> 'withdrawn'$q$;
begin
  v := sr.run_as(admin_a, $q$select count(*)::text from public.selection_roster('00000000-0000-0000-0000-0000000004b1')$q$);
  perform sr.ok(v = 'OK:3', 'admin roster: 2 active + 1 withdrawn history (' || v || ')');
  v := sr.run_as(finance_a, $q$select (balance::text || '|' || received::text || '|' || payment_status || '|' || show_money::text)
        from public.selection_roster('00000000-0000-0000-0000-0000000004b1') where athlete_id = '00000000-0000-0000-0000-000000000071'$q$);
  perform sr.ok(v = 'OK:4200.00|300.00|partial|true', 'finance sees fee, received, balance (' || v || ')');
  v := sr.run_as(coach1, $q$select count(*)::text || ':' || coalesce(max(balance)::text, 'null') || ':' || coalesce(max(payment_status), 'null') || ':' || bool_or(show_money)::text
        from public.selection_roster('00000000-0000-0000-0000-0000000004b1')$q$);
  perform sr.ok(v = 'OK:3:null:null:false', 'assigned coach: roster without amounts or payment status (' || v || ')');
  update public.programs set roster_coach_payment_status = true where id = '00000000-0000-0000-0000-0000000004b1';
  v := sr.run_as(coach1, $q$select coalesce(max(balance)::text, 'null') || ':' || coalesce(min(payment_status), 'null')
        from public.selection_roster('00000000-0000-0000-0000-0000000004b1') where status = 'enrolled'$q$);
  perform sr.ok(v = 'OK:null:partial', 'club setting: coach sees the payment status badge, never amounts (' || v || ')');
  update public.programs set roster_coach_payment_status = false where id = '00000000-0000-0000-0000-0000000004b1';
  v := sr.run_as(coach2, $q$select count(*)::text from public.selection_roster('00000000-0000-0000-0000-0000000004b1')$q$);
  perform sr.ok(v = 'OK:0', 'unassigned coach: no roster (' || v || ')');
  v := sr.run_as(guardian, $q$select count(*)::text from public.selection_roster('00000000-0000-0000-0000-0000000004b1')$q$);
  perform sr.ok(v = 'OK:0', 'guardian: no roster (' || v || ')');
  v := sr.run_as(admin_b, $q$select count(*)::text from public.selection_roster('00000000-0000-0000-0000-0000000004b1')$q$);
  perform sr.ok(v = 'OK:0', 'other org: no roster (' || v || ')');

  -- Athlete card.
  v := sr.run_as(guardian, $q$select count(*)::text || ':' || max(balance)::text || ':' || bool_and(show_money)::text
        from public.selection_athlete_enrollments('00000000-0000-0000-0000-000000000071')$q$);
  perform sr.ok(v = 'OK:1:4200.00:true', 'guardian sees her child''s enrolment with the payment summary (' || v || ')');
  v := sr.run_as(guardian2, $q$select count(*)::text from public.selection_athlete_enrollments('00000000-0000-0000-0000-000000000071')$q$);
  perform sr.ok(v = 'OK:0', 'other family sees nothing (' || v || ')');
  v := sr.run_as(guardian2, $q$select count(*)::text || ':' || bool_and(show_money)::text from public.selection_athlete_enrollments('00000000-0000-0000-0000-000000000072')$q$);
  perform sr.ok(v = 'OK:1:true', 'other family sees its own child (' || v || ')');
  v := sr.run_as(coach1, $q$select count(*)::text || ':' || coalesce(max(balance)::text, 'null') || ':' || bool_or(show_money)::text
        from public.selection_athlete_enrollments('00000000-0000-0000-0000-000000000071')$q$);
  perform sr.ok(v = 'OK:1:null:false', 'coach sees the enrolment without amounts (' || v || ')');
  v := sr.run_as(finance_a, $q$select max(balance)::text from public.selection_athlete_enrollments('00000000-0000-0000-0000-000000000071')$q$);
  perform sr.ok(v = 'OK:4200.00', 'finance sees the amounts (' || v || ')');
  v := sr.run_as(admin_b, $q$select count(*)::text from public.selection_athlete_enrollments('00000000-0000-0000-0000-000000000071')$q$);
  perform sr.ok(v = 'OK:0', 'other org sees nothing (' || v || ')');

  -- Coverage rows follow application visibility.
  v := sr.run_as(guardian, $q$select count(*)::text from public.application_tournaments$q$);
  perform sr.ok(v = 'OK:2', 'guardian reads her child''s tournaments (' || v || ')');
  v := sr.run_as(guardian2, $q$select count(*)::text from public.application_tournaments$q$);
  perform sr.ok(v = 'OK:0', 'other family reads none (' || v || ')');
  v := sr.run_as(admin_b, $q$select count(*)::text from public.application_tournaments$q$);
  perform sr.ok(v = 'OK:0', 'other org reads none (' || v || ')');
end $$;

-- ===========================================================================
-- F. Edit, jersey, withdraw, move
-- ===========================================================================
do $$
declare v text; r record;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  coach1 uuid := '00000000-0000-0000-0000-0000000000f3';
begin
  v := sr.run_as(admin_a, format($q$select public.selection_update_enrollment(%L, '{"jersey_number": "7", "staff_notes": "Synthetic"}')->>'status'$q$, sr.get('app1')));
  perform sr.ok(v = 'OK:enrolled', 'jersey 7 and notes saved (' || v || ')');
  perform sr.ok((select jersey_number = 7 from public.team_memberships where team_id = '00000000-0000-0000-0000-0000000004a1'
                  and athlete_id = '00000000-0000-0000-0000-000000000071'), 'jersey on the division team membership');
  -- Move player 2 to U14 and try the same jersey.
  v := sr.run_as(admin_a, format($q$select public.selection_update_enrollment(%L, '{"division_id": "00000000-0000-0000-0000-0000000004c1"}')->>'division_id'$q$, sr.get('app2')));
  perform sr.ok(v = 'OK:00000000-0000-0000-0000-0000000004c1', 'division changed (' || v || ')');
  perform sr.ok(exists (select 1 from public.team_memberships where team_id = '00000000-0000-0000-0000-0000000004a1'
                         and athlete_id = '00000000-0000-0000-0000-000000000072' and status = 'active')
                and exists (select 1 from public.team_memberships where team_id = '00000000-0000-0000-0000-0000000004a2'
                         and athlete_id = '00000000-0000-0000-0000-000000000072' and status = 'inactive'), 'team roster follows the division');
  v := sr.run_as(admin_a, format($q$select public.selection_update_enrollment(%L, '{"jersey_number": 7}')::text$q$, sr.get('app2')));
  perform sr.ok(v like 'ERR:%JERSEY_TAKEN%', 'jersey number unique per team (' || left(v, 50) || ')');
  v := sr.run_as(coach1, format($q$select public.selection_update_enrollment(%L, '{"staff_notes": "coach"}')::text$q$, sr.get('app1')));
  perform sr.ok(v like 'ERR:%APPLICATION_NOT_FOUND%', 'a coach cannot edit enrolments');
  v := sr.run_as(finance_a, format($q$select public.selection_update_enrollment(%L, '{"staff_notes": "finance"}')::text$q$, sr.get('app1')));
  perform sr.ok(v like 'ERR:%APPLICATION_NOT_FOUND%', 'finance cannot edit enrolments');

  -- Move season: refused with payments, allowed without.
  v := sr.run_as(admin_a, format($q$select public.selection_move_enrollment(%L, '00000000-0000-0000-0000-0000000004b2', '00000000-0000-0000-0000-0000000004c3', '00000000-0000-0000-0000-0000000004d4')::text$q$, sr.get('app1')));
  perform sr.ok(v like 'ERR:%MOVE_HAS_PAYMENTS%', 'cannot move a season with payments (' || left(v, 50) || ')');
  v := sr.run_as(admin_a, format($q$select public.selection_move_enrollment(%L, '00000000-0000-0000-0000-0000000004b2', '00000000-0000-0000-0000-0000000004c3', '00000000-0000-0000-0000-0000000004d4')->>'status'$q$, sr.get('app2')));
  perform sr.ok(v = 'OK:enrolled', 'player 2 moved to season 2, still enrolled (' || v || ')');
  perform sr.ok((select program_id = '00000000-0000-0000-0000-0000000004b2' and agreed_fee = 2000 and arrangement_kind = 'monthly' and monthly_amount = 300 and arrangement_installments = 7
                  from public.program_applications where id = sr.get('app2')::uuid), 'season 2: new invoice on the season-2 package, arrangement kept (2000 / 300 -> 7)');
  perform sr.ok(exists (select 1 from public.registrations where athlete_id = '00000000-0000-0000-0000-000000000072'
                         and program_id = '00000000-0000-0000-0000-0000000004b2' and status = 'confirmed')
                and not exists (select 1 from public.registrations where athlete_id = '00000000-0000-0000-0000-000000000072'
                         and program_id = '00000000-0000-0000-0000-0000000004b1' and status = 'confirmed'), 'registration moved');

  -- Withdraw one tournament, then the whole enrolment.
  v := sr.run_as(admin_a, format($q$select public.selection_withdraw_tournament(%L, %L, '')::text$q$, sr.get('app1'), sr.get('t3')));
  perform sr.ok(v like 'ERR:%REASON_REQUIRED%', 'tournament withdrawal needs a reason');
  v := sr.run_as(admin_a, format($q$select public.selection_withdraw_tournament(%L, %L, 'Injured')->>'status'$q$, sr.get('app1'), sr.get('t3')));
  perform sr.ok(v = 'OK:withdrawn', 'one tournament withdrawn (' || v || ')');
  perform sr.ok((select status = 'withdrawn' and withdrawn_at is not null and note = 'Injured' from public.application_tournaments
                  where application_id = sr.get('app1')::uuid and tournament_id = sr.get('t3')::uuid), 'tournament withdrawal recorded');
  v := sr.run_as(finance_a, format($q$select public.selection_withdraw_enrollment(%L, 'x')::text$q$, sr.get('app1')));
  perform sr.ok(v like 'ERR:%APPLICATION_NOT_FOUND%', 'finance cannot withdraw enrolments');
  v := sr.run_as(admin_a, format($q$select public.selection_withdraw_enrollment(%L, '')::text$q$, sr.get('app1')));
  perform sr.ok(v like 'ERR:%REASON_REQUIRED%', 'withdrawal needs a reason');
  v := sr.run_as(admin_a, format($q$select public.selection_withdraw_enrollment(%L, 'Family moved abroad')->>'balance_at_withdrawal'$q$, sr.get('app1')));
  perform sr.ok(v = 'OK:4200.00', 'withdrawn: outstanding balance at withdrawal 4200 (' || v || ')');
  select a.status, a.withdrawal_reason, a.withdrawn_at, a.balance_at_withdrawal, i.status::text as inv_status into r
    from public.program_applications a join public.invoices i on i.id = a.invoice_id where a.id = sr.get('app1')::uuid;
  perform sr.ok(r.status = 'withdrawn' and r.withdrawal_reason = 'Family moved abroad' and r.withdrawn_at is not null
                and r.inv_status not in ('cancelled', 'void'), 'application kept, invoice NOT cancelled');
  perform sr.ok((select count(*) = 3 from public.payments where invoice_id = sr.get('inv1')::uuid), 'payments kept (incl. void history)');
  perform sr.ok(exists (select 1 from public.payment_plans where invoice_id = sr.get('inv1')::uuid and status = 'active'), 'plan kept');
  perform sr.ok((select balance = 4200 from public.selection_invoice_summary(sr.get('inv1')::uuid)), 'balance still owed (fee change only by adjustment)');
  perform sr.ok(exists (select 1 from public.registrations where athlete_id = '00000000-0000-0000-0000-000000000071'
                         and program_id = '00000000-0000-0000-0000-0000000004b1' and status = 'cancelled'), 'registration cancelled');
  perform sr.ok((select bool_and(status = 'withdrawn') from public.application_tournaments where application_id = sr.get('app1')::uuid), 'tournaments withdrawn');
  v := sr.run_as(admin_a, $q$select string_agg(status, ',') from public.selection_roster('00000000-0000-0000-0000-0000000004b1') where athlete_id = '00000000-0000-0000-0000-000000000071'$q$);
  perform sr.ok(v = 'OK:withdrawn', 'withdrawn enrolment stays on the roster history (' || v || ')');
  v := sr.run_as('00000000-0000-0000-0000-0000000000f4', $q$select string_agg(status, ',') from public.selection_athlete_enrollments('00000000-0000-0000-0000-000000000071')$q$);
  perform sr.ok(v = 'OK:withdrawn', 'and on the athlete profile history (' || v || ')');
  -- A new enrolment is possible after withdrawal (one LIVE per programme).
  v := sr.run_as(admin_a, $q$select public.selection_staff_add('00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-000000000071',
        '00000000-0000-0000-0000-0000000004c1', '00000000-0000-0000-0000-0000000004d1', '{}'::uuid[], 'full', null, current_date, 'accepted', 'later')->>'status'$q$);
  perform sr.ok(v = 'OK:accepted', 're-enrolment after withdrawal allowed (' || v || ')');
end $$;

select 'selection_roster suite done' as done;
