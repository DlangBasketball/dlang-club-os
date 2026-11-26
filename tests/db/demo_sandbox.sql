-- ============================================================================
-- Prospect demo sandbox suite (migration 20250420107000_demo_sandbox.sql)
--
-- Runs the sales-demo journey through the same RPCs and RLS the screens use:
--   A. Create: only the service role; only fresh demo.example.com logins;
--      starting state (Alex no request / no roster, Sam on U12 Comets, one
--      U14 practice today, camp + package, invoices with sandbox payments).
--   B. Parent: switches between Alex and Sam (my_athletes), submits Alex's
--      club programme request (pending, nothing else written).
--   C. Club admin approves -> Alex confirmed and on the U14 Falcons roster;
--      Coach Taylor sees the SAME athlete id on his roster.
--   D. Coach Taylor marks Alex present and finalizes; Alex sees "present" in
--      the athlete overview.
--   E. Jamie books the skills camp -> invoice; Finance reads the invoice and
--      its sandbox payment status; Casey's camp invoice + sandbox payment.
--   F. A second prospect starts with the original state; resetting the first
--      restores its starting records and leaves the second untouched.
--   G. Permissions: coach only his team, parent only own children, athlete
--      only own record, demo roles never reach another club, demo_sandboxes
--      and the demo RPCs closed to API users.
--
-- SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema dm;
grant usage on schema dm to authenticated, anon, service_role;
create table dm.ctx (k text primary key, v text);
grant all on dm.ctx to authenticated, anon, service_role;

create function dm.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function dm.put(p_k text, p_v text) returns void language sql as $$
  insert into dm.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function dm.uid(p_k text) returns uuid language sql stable as $$ select v::uuid from dm.ctx where k = p_k $$;
create function dm.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    if p is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
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
create function dm.j(p uuid, p_sql text) returns jsonb language plpgsql as $$
declare r text := dm.run_as(p, p_sql);
begin
  if left(r, 3) = 'OK:' then
    if substr(r, 4) = '<null>' then return 'null'::jsonb; end if;
    return substr(r, 4)::jsonb;
  end if;
  return jsonb_build_object('err', substr(r, 5));
end $$;
create function dm.n(p uuid, p_sql text) returns int language plpgsql as $$
declare r text := dm.run_as(p, p_sql);
begin
  if left(r, 3) = 'OK:' then return substr(r, 4)::int; end if;
  return -1;
end $$;
-- Five fresh demo logins for prospect p_key (handle_new_user creates profiles).
create function dm.logins(p_key text) returns void language plpgsql as $$
declare r text;
begin
  foreach r in array array['admin', 'finance', 'coach', 'parent', 'player'] loop
    insert into auth.users (id, email) values (gen_random_uuid(), 'demo-' || p_key || '-' || r || '@demo.example.com');
    perform dm.put(p_key || '.' || r, (select id::text from auth.users where email = 'demo-' || p_key || '-' || r || '@demo.example.com'));
  end loop;
end $$;
create function dm.create(p_key text) returns jsonb language sql as $$
  select public.demo_sandbox_create(rpad(md5(p_key), 64, 'f'),
    dm.uid(p_key || '.admin'), dm.uid(p_key || '.finance'), dm.uid(p_key || '.coach'),
    dm.uid(p_key || '.parent'), dm.uid(p_key || '.player'))
$$;
-- Ids inside a prospect's current club.
create function dm.org(p_key text) returns uuid language sql stable as $$
  select org_id from public.demo_sandboxes where admin_profile_id = dm.uid(p_key || '.admin')
$$;
create function dm.ath(p_key text, p_first text) returns uuid language sql stable as $$
  select id from public.athletes where org_id = dm.org(p_key) and first_name = p_first and last_name in ('Morgan', 'Brooks')
$$;
create function dm.team(p_key text, p_name text) returns uuid language sql stable as $$
  select id from public.teams where org_id = dm.org(p_key) and name = p_name
$$;
create function dm.prog(p_key text, p_slug text) returns uuid language sql stable as $$
  select id from public.programs where org_id = dm.org(p_key) and slug = p_slug
$$;
create function dm.practice(p_key text) returns uuid language sql stable as $$
  select e.id from public.events e where e.team_id = dm.team(p_key, 'U14 Falcons') order by e.starts_at limit 1
$$;
grant execute on all functions in schema dm to authenticated, anon, service_role;

-- ============================================================ A. create
do $$
declare r text; j jsonb;
begin
  perform dm.logins('p1');

  -- API users cannot create, reset or expire a sandbox.
  r := dm.run_as(dm.uid('p1.parent'), format('select public.demo_sandbox_create(%L, %L, %L, %L, %L, %L)::text',
       repeat('b', 64), dm.uid('p1.admin'), dm.uid('p1.finance'), dm.uid('p1.coach'), dm.uid('p1.parent'), dm.uid('p1.player')));
  perform dm.ok(r like 'ERR:permission denied%' or r like 'ERR:NOT_AUTHORIZED%', 'an authenticated user cannot create a sandbox — ' || r);
  r := dm.run_as(null, 'select public.demo_sandbox_expire()::text');
  perform dm.ok(r like 'ERR:%', 'anon cannot run the expiry job');

  -- A real account (not on demo.example.com) is never pulled into a demo club.
  begin
    perform public.demo_sandbox_create(repeat('c', 64), '00000000-0000-0000-0000-0000000000f1',
            dm.uid('p1.finance'), dm.uid('p1.coach'), dm.uid('p1.parent'), dm.uid('p1.player'));
    perform dm.ok(false, 'a real club admin is refused as a demo login');
  exception when others then
    perform dm.ok(sqlerrm = 'INVALID_PROFILES', 'a real club admin is refused as a demo login (INVALID_PROFILES)');
  end;
  perform dm.ok((select org_id from public.profiles where id = '00000000-0000-0000-0000-0000000000f1') = '00000000-0000-0000-0000-000000000001',
                'the real admin stays in their own club');

  j := dm.create('p1');
  perform dm.ok(j ? 'org_id' and dm.org('p1') = (j->>'org_id')::uuid, 'service role creates sandbox p1');
  perform dm.ok((select demo_sandbox_id is not null from public.organizations where id = dm.org('p1')), 'the sandbox club is flagged as a demo club');

  -- Starting state.
  perform dm.ok((select count(*) = 2 from public.teams where org_id = dm.org('p1') and name in ('U14 Falcons', 'U12 Comets')), 'U14 Falcons and U12 Comets exist');
  perform dm.ok((select c.display_name = 'Coach Taylor' from public.team_coaches tc join public.coaches c on c.id = tc.coach_id
                  where tc.team_id = dm.team('p1', 'U14 Falcons') and tc.role = 'head'), 'Coach Taylor heads U14 Falcons');
  perform dm.ok((select c.display_name = 'Coach Rivera' from public.team_coaches tc join public.coaches c on c.id = tc.coach_id
                  where tc.team_id = dm.team('p1', 'U12 Comets') and tc.role = 'head'), 'Coach Rivera heads U12 Comets');
  perform dm.ok(not exists (select 1 from public.registrations where athlete_id = dm.ath('p1', 'Alex'))
                and not exists (select 1 from public.club_approval_requests where athlete_id = dm.ath('p1', 'Alex'))
                and not exists (select 1 from public.team_memberships where athlete_id = dm.ath('p1', 'Alex')),
                'Alex: registration not yet submitted, no roster place');
  perform dm.ok(exists (select 1 from public.team_memberships where athlete_id = dm.ath('p1', 'Sam')
                         and team_id = dm.team('p1', 'U12 Comets') and status = 'active'), 'Sam is an active U12 Comets member');
  perform dm.ok((select count(*) = 1 from public.events e where e.team_id = dm.team('p1', 'U14 Falcons')
                  and (e.starts_at at time zone 'Europe/Zurich')::date = (now() at time zone 'Europe/Zurich')::date
                  and e.type::text = 'training'), 'one U14 Falcons practice today');
  perform dm.ok(exists (select 1 from public.camp_editions where program_id = dm.prog('p1', 'skills-camp') and status = 'published')
                and exists (select 1 from public.credit_packages where org_id = dm.org('p1') and credits = 5),
                'skills camp (published edition) and 5-session package exist');
  perform dm.ok((select count(*) = 3 from public.invoices where org_id = dm.org('p1')), 'three sample invoices');
  perform dm.ok((select count(*) = 2 from public.payments p join public.invoices i on i.id = p.invoice_id
                  where i.org_id = dm.org('p1') and p.notes like 'Sandbox%' and p.qr_reference = i.payment_reference),
                'two sandbox payments carry their invoice reference');
  perform dm.ok(exists (select 1 from public.registrations r join public.invoices i on i.id = r.invoice_id
                         where r.athlete_id = dm.ath('p1', 'Riley') and r.status = 'confirmed' and i.status = 'paid'
                           and i.payer_name = 'Casey Brooks'), 'Casey Brooks: confirmed camp place, paid invoice');
  perform dm.ok(not exists (select 1 from public.profiles p where p.org_id = dm.org('p1') and lower(p.email::text) not like '%@demo.example.com')
                and not exists (select 1 from public.families where org_id = dm.org('p1') and contact_email not like '%@demo.example.com'),
                'every e-mail in the demo club is on the reserved demo.example.com domain');
  perform dm.ok((select count(*) = 5 from public.profiles where org_id = dm.org('p1') and onboarding_completed_at is not null),
                'the five logins belong to the demo club');
end $$;

-- ============================================================ B. parent
do $$
declare j jsonb; r text; v_req uuid;
begin
  j := dm.j(dm.uid('p1.parent'), 'select public.my_athletes()::text');
  perform dm.ok(jsonb_array_length(j) = 2 and j::text like '%Alex%' and j::text like '%Sam%',
                'Jamie''s athlete switcher lists exactly Alex and Sam');
  r := dm.run_as(dm.uid('p1.parent'), format('select public.my_athlete_resolve(%L)::text', dm.ath('p1', 'Sam')));
  perform dm.ok(r like 'OK:%' and r not like 'OK:<null>', 'switching to Sam resolves — ' || r);
  r := dm.run_as(dm.uid('p1.parent'), format('select public.my_athlete_resolve(%L)::text', dm.ath('p1', 'Riley')));
  perform dm.ok(r like 'ERR:%' or r = 'OK:<null>' or r = 'OK:false', 'switching to another family''s child is refused — ' || r);

  j := dm.j(dm.uid('p1.parent'), format('select public.club_request_submit(%L::jsonb, %L)::text',
         jsonb_build_object('kind', 'program_registration', 'program_id', dm.prog('p1', 'u14-falcons'), 'athlete_id', dm.ath('p1', 'Alex')),
         gen_random_uuid()));
  v_req := (j->>'id')::uuid;
  perform dm.put('p1.req', v_req::text);
  perform dm.ok(v_req is not null and j->>'status' = 'pending', 'Jamie submits Alex''s U14 Falcons registration — ' || j::text);
  perform dm.ok(not exists (select 1 from public.team_memberships where athlete_id = dm.ath('p1', 'Alex')),
                'while pending, Alex is not on any roster');
  j := dm.j(dm.uid('p1.parent'), 'select coalesce(jsonb_agg(x), ''[]''::jsonb)::text from public.club_request_family_list() x');
  perform dm.ok(j::text like '%' || v_req::text || '%' and j::text like '%pending%', 'Jamie sees the request as pending');
end $$;

-- ============================================================ C. admin approves, coach roster
do $$
declare j jsonb; r text; v_roster jsonb;
begin
  j := dm.j(dm.uid('p1.admin'), 'select coalesce(jsonb_agg(x), ''[]''::jsonb)::text from public.club_request_queue(''open'') x');
  perform dm.ok(j::text like '%' || dm.uid('p1.req')::text || '%', 'the club admin sees Alex''s request in Approvals');
  j := dm.j(dm.uid('p1.finance'), format('select public.club_request_decide(%L, ''approve'', null, %L)::text', dm.uid('p1.req'), gen_random_uuid()));
  perform dm.ok(j ? 'err', 'finance cannot decide a club request');

  j := dm.j(dm.uid('p1.admin'), format('select public.club_request_decide(%L, ''approve'', null, %L)::text', dm.uid('p1.req'), gen_random_uuid()));
  perform dm.ok(not (j ? 'err'), 'the club admin approves Alex for U14 Falcons — ' || j::text);
  perform dm.ok(exists (select 1 from public.registrations where athlete_id = dm.ath('p1', 'Alex')
                         and program_id = dm.prog('p1', 'u14-falcons') and status = 'confirmed'), 'Alex''s registration is confirmed');
  perform dm.ok(exists (select 1 from public.team_memberships where athlete_id = dm.ath('p1', 'Alex')
                         and team_id = dm.team('p1', 'U14 Falcons') and status = 'active'), 'Alex is on the U14 Falcons roster');
  perform dm.ok((select count(*) = 1 from public.athletes where org_id = dm.org('p1') and first_name = 'Alex'),
                'no duplicate athlete record was created');

  v_roster := dm.j(dm.uid('p1.coach'), format('select coalesce(jsonb_agg(x), ''[]''::jsonb)::text from public.team_roster_on(%L, null) x',
                   dm.team('p1', 'U14 Falcons')));
  perform dm.ok(v_roster::text like '%' || dm.ath('p1', 'Alex')::text || '%',
                'Coach Taylor''s U14 Falcons roster lists Alex with the same athlete id');
  perform dm.ok(jsonb_array_length(v_roster) = 5, 'U14 Falcons roster: Alex + 4 team-mates — ' || jsonb_array_length(v_roster));
end $$;

-- ============================================================ D. attendance
do $$
declare j jsonb; v_ev uuid := dm.practice('p1'); v_ver int;
begin
  j := dm.j(dm.uid('p1.coach'), format('select public.attendance_open(%L)::text', v_ev));
  perform dm.ok(j->'sheet' is not null and j::text like '%' || dm.ath('p1', 'Alex')::text || '%',
                'Coach Taylor opens today''s practice; Alex is on the sheet');
  v_ver := (j->'sheet'->>'version')::int;
  j := dm.j(dm.uid('p1.coach'), format('select public.attendance_save(%L, %L::jsonb, %s, %L, false)::text', v_ev,
         jsonb_build_array(jsonb_build_object('athlete_id', dm.ath('p1', 'Alex'), 'status', 'present', 'base_rev', 0)), v_ver, gen_random_uuid()));
  perform dm.ok(not (j ? 'err') and jsonb_array_length(j->'applied') = 1, 'Coach Taylor marks Alex present — ' || left(j::text, 200));
  v_ver := (j->>'version')::int;
  j := dm.j(dm.uid('p1.coach'), format('select public.attendance_mark_all_present(%L, %s, %L)::text', v_ev, v_ver, gen_random_uuid()));
  v_ver := coalesce((j->>'version')::int, v_ver);
  j := dm.j(dm.uid('p1.coach'), format('select public.attendance_finalize(%L, null, %s, %L, false)::text', v_ev, v_ver, gen_random_uuid()));
  perform dm.ok((j->>'ok')::boolean, 'Coach Taylor submits the register — ' || left(j::text, 200));

  j := dm.j(dm.uid('p1.player'), 'select public.player_attendance_overview(null, null)::text');
  perform dm.ok(j::text like '%present%' and j::text like '%' || v_ev::text || '%', 'Alex sees "present" for the practice in the athlete view');
  j := dm.j(dm.uid('p1.player'), 'select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb)::text from public.player_me() x');
  perform dm.ok(j::text like '%U14 Falcons%', 'Alex''s athlete view shows U14 Falcons — ' || left(j::text, 160));
end $$;

-- ============================================================ E. booking, invoice, sandbox payment
do $$
declare j jsonb; v_inv uuid; v_ed uuid; v_start date;
begin
  select id, starts_on into v_ed, v_start from public.camp_editions where program_id = dm.prog('p1', 'skills-camp');
  -- Same payload submitCampParent() sends (service role, mode parent).
  j := public.register_camp(jsonb_build_object(
    'mode', 'parent', 'program_id', dm.prog('p1', 'skills-camp'), 'edition_id', v_ed,
    'family_id', (select family_id from public.athletes where id = dm.ath('p1', 'Sam')),
    'registered_by', dm.uid('p1.parent'),
    'children', jsonb_build_array(jsonb_build_object(
      'athlete_id', dm.ath('p1', 'Sam'),
      'age_group_id', (select id from public.camp_age_groups where program_id = dm.prog('p1', 'skills-camp')),
      'price_option_id', (select id from public.camp_price_options where program_id = dm.prog('p1', 'skills-camp') and days_count = 5),
      'list_amount', 390, 'discounts', '[]'::jsonb,
      'days', (select jsonb_agg(v_start + d) from generate_series(0, 4) d))),
    'consents', '[]'::jsonb));
  v_inv := (j->>'invoice_id')::uuid;
  perform dm.put('p1.campinv', v_inv::text);
  perform dm.ok(v_inv is not null, 'Jamie books the skills camp for Sam -> invoice ' || coalesce(j->>'invoice_number', '?'));

  perform dm.ok(dm.n(dm.uid('p1.parent'), format('select count(*) from public.invoices where id = %L', v_inv)) = 1,
                'Jamie sees the camp invoice');
  perform dm.ok(dm.n(dm.uid('p1.finance'), format('select count(*) from public.invoices where id = %L and status::text in (''sent'',''pending'')', v_inv)) = 1,
                'Finance opens the matching invoice (open, awaiting payment)');
  perform dm.ok(dm.n(dm.uid('p1.finance'), format('select count(*) from public.registrations where invoice_id = %L and athlete_id = %L', v_inv, dm.ath('p1', 'Sam'))) = 1,
                'Finance follows the booking -> invoice link');
  perform dm.ok(dm.n(dm.uid('p1.finance'),
                'select count(*) from public.payments p join public.invoices i on i.id = p.invoice_id where p.notes like ''Sandbox%'' and p.qr_reference = i.payment_reference') = 2,
                'Finance sees the sandbox payments with matching references');
  perform dm.ok(dm.n(dm.uid('p1.finance'),
                'select count(*) from public.invoices where payer_name = ''Casey Brooks'' and status = ''paid''') = 1,
                'Finance sees Casey Brooks''s paid external camp invoice');
  perform dm.ok(dm.n(dm.uid('p1.finance'), 'select count(*) from public.athlete_medical') <= 0,
                'Finance reads no medical data');
end $$;

-- ============================================================ F. second prospect, reset
do $$
declare j jsonb; v_old uuid; v_alex_old uuid;
begin
  perform dm.logins('p2');
  j := dm.create('p2');
  perform dm.ok(dm.org('p2') <> dm.org('p1'), 'prospect 2 gets its own club');
  perform dm.ok(not exists (select 1 from public.club_approval_requests where org_id = dm.org('p2'))
                and not exists (select 1 from public.team_memberships where athlete_id = dm.ath('p2', 'Alex')),
                'prospect 2 starts from the original scenario');
  perform dm.ok(dm.n(dm.uid('p2.admin'), 'select count(*) from public.club_approval_requests') = 0
                and dm.n(dm.uid('p2.admin'), format('select count(*) from public.athletes where id = %L', dm.ath('p1', 'Alex'))) = 0,
                'prospect 2 cannot see prospect 1''s records');
  -- Prospect 2 acts before prospect 1 resets.
  j := dm.j(dm.uid('p2.parent'), format('select public.club_request_submit(%L::jsonb, %L)::text',
         jsonb_build_object('kind', 'program_registration', 'program_id', dm.prog('p2', 'u14-falcons'), 'athlete_id', dm.ath('p2', 'Alex')),
         gen_random_uuid()));
  perform dm.ok(j->>'status' = 'pending', 'prospect 2 submits its own request');

  v_old := dm.org('p1'); v_alex_old := dm.ath('p1', 'Alex');
  j := public.demo_sandbox_reset((select id from public.demo_sandboxes where org_id = v_old));
  perform dm.ok((j->>'previous_org_id')::uuid = v_old and dm.org('p1') <> v_old, 'reset gives prospect 1 a fresh club');
  perform dm.ok(not exists (select 1 from public.club_approval_requests where org_id = dm.org('p1'))
                and not exists (select 1 from public.team_memberships where athlete_id = dm.ath('p1', 'Alex'))
                and (select count(*) = 3 from public.invoices where org_id = dm.org('p1')),
                'reset restores prospect 1''s starting records');
  perform dm.ok(dm.n(dm.uid('p1.parent'), format('select count(*) from public.athletes where id = %L', v_alex_old)) = 0
                and dm.n(dm.uid('p1.admin'), 'select count(*) from public.club_approval_requests') = 0,
                'after reset, prospect 1''s logins no longer reach the old records');
  perform dm.ok(dm.n(dm.uid('p1.coach'), format('select count(*) from public.team_roster_on(%L, null)', dm.team('p1', 'U14 Falcons'))) = 4,
                'Coach Taylor''s roster is back to 4 (Alex not placed)');
  perform dm.ok((select count(*) = 1 from public.club_approval_requests where org_id = dm.org('p2') and status = 'pending'),
                'prospect 2''s request is untouched by prospect 1''s reset');
  perform dm.ok(not exists (select 1 from public.staff_roles where org_id = v_old)
                and not exists (select 1 from public.family_members fm join public.families f on f.id = fm.family_id where f.org_id = v_old),
                'the detached club keeps no member');
end $$;

-- ============================================================ G. permissions
do $$
declare r text;
begin
  -- Coach: only assigned teams.
  r := dm.run_as(dm.uid('p1.coach'), format('select count(*)::text from public.team_roster_on(%L, null)', dm.team('p1', 'U12 Comets')));
  perform dm.ok(r like 'ERR:%' or r = 'OK:0', 'Coach Taylor cannot read the U12 Comets roster — ' || r);
  perform dm.ok(dm.n(dm.uid('p1.coach'), format('select count(*) from public.athletes where id = %L', dm.ath('p1', 'Sam'))) = 0,
                'Coach Taylor cannot read Sam (not on his team)');
  -- Parent: only linked athletes.
  perform dm.ok(dm.n(dm.uid('p1.parent'), 'select count(*) from public.athletes') = 2, 'Jamie reads exactly two athletes');
  perform dm.ok(dm.n(dm.uid('p1.parent'), 'select count(*) from public.invoices where payer_name = ''Casey Brooks''') = 0,
                'Jamie cannot read Casey''s invoice');
  -- Athlete: only own record.
  perform dm.ok(dm.n(dm.uid('p1.player'), 'select count(*) from public.athletes') <= 1
                and dm.n(dm.uid('p1.player'), format('select count(*) from public.athletes where id = %L', dm.ath('p1', 'Sam'))) <= 0,
                'Alex cannot read Sam''s record');
  perform dm.ok(dm.n(dm.uid('p1.player'), 'select count(*) from public.invoices') <= 0, 'Alex reads no invoices');
  -- No demo role reaches a real club (org A of the fixtures stands in for production data).
  perform dm.ok(dm.n(dm.uid('p1.admin'), 'select count(*) from public.athletes where org_id = ''00000000-0000-0000-0000-000000000001''') = 0
                and dm.n(dm.uid('p1.finance'), 'select count(*) from public.invoices where org_id = ''00000000-0000-0000-0000-000000000001''') = 0
                and dm.n(dm.uid('p1.coach'), 'select count(*) from public.teams where org_id = ''00000000-0000-0000-0000-000000000001''') = 0,
                'demo admin / finance / coach read nothing of a real club');
  r := dm.run_as(dm.uid('p1.admin'), 'update public.profiles set org_id = ''00000000-0000-0000-0000-000000000001'' where id = auth.uid() returning 1');
  perform dm.ok(r like 'ERR:%' or r = 'OK:<null>', 'a demo login cannot move itself into a real club — ' || r);
  -- And the other way round.
  perform dm.ok(dm.n('00000000-0000-0000-0000-0000000000f1', format('select count(*) from public.athletes where org_id = %L', dm.org('p1'))) = 0,
                'a real club admin reads nothing of a demo club');
  -- demo_sandboxes is closed to API users.
  perform dm.ok(dm.n(dm.uid('p1.admin'), 'select count(*) from public.demo_sandboxes') = -1
                or dm.n(dm.uid('p1.admin'), 'select count(*) from public.demo_sandboxes') = 0, 'demo_sandboxes unreadable by a demo admin');
  r := dm.run_as(dm.uid('p1.admin'), 'select public.demo_sandbox_reset((select id from public.demo_sandboxes limit 1))::text');
  perform dm.ok(r like 'ERR:%', 'a demo admin cannot call demo_sandbox_reset');
  perform dm.ok(public.org_is_demo(dm.org('p1')) and not public.org_is_demo('00000000-0000-0000-0000-000000000001'),
                'org_is_demo: demo club true, real club false');
  r := dm.run_as(dm.uid('p1.parent'), format('select public.org_is_demo(%L)::text', dm.org('p1')));
  perform dm.ok(r like 'ERR:%', 'org_is_demo is not callable by API users');
end $$;

-- ============================================================ H. expiry
do $$
declare v_ids uuid[];
begin
  update public.demo_sandboxes set expires_at = now() - interval '1 minute' where org_id = dm.org('p2');
  v_ids := public.demo_sandbox_expire();
  perform dm.ok(array_length(v_ids, 1) = 5 and dm.uid('p2.admin') = any (v_ids), 'expiry returns the five logins of prospect 2');
  perform dm.ok(dm.n(dm.uid('p2.admin'), 'select count(*) from public.staff_roles') = 0
                and (select status = 'expired' from public.demo_sandboxes where admin_profile_id = dm.uid('p2.admin')),
                'an expired sandbox keeps no role');
  begin
    perform public.demo_sandbox_reset((select id from public.demo_sandboxes where admin_profile_id = dm.uid('p2.admin')));
    perform dm.ok(false, 'an expired sandbox cannot be reset');
  exception when others then
    perform dm.ok(sqlerrm = 'SANDBOX_EXPIRED', 'an expired sandbox cannot be reset (SANDBOX_EXPIRED)');
  end;
  perform dm.ok((select status = 'active' from public.demo_sandboxes where admin_profile_id = dm.uid('p1.admin')), 'prospect 1 is still active');
end $$;
