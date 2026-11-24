-- ============================================================================
-- My Athletes suite (migration 20250420106200_my_athletes_sync.sql)
--
--   A. Two children (and "Myself") under one parent: my_athletes() lists them;
--      my_athlete_resolve() (active-athlete validation) ignores another
--      family's, another club's and unknown ids.
--   B. Coach: confirmed players of own teams only (no unconfirmed / other
--      team); sports-only writes.
--   C. Finance: billing only — no medical, no sports profile RPC, no profile
--      edits (RPC or direct), no profile history.
--   D. Duplicates: same parent adds the same child twice -> same athlete;
--      another family's child -> opaque POSSIBLE_MATCH + link request, no
--      duplicate; data check flags (duplicate / self link / no guardian),
--      idempotent; self link only after staff confirm; staff merge moves links,
--      records unique conflicts, archives the duplicate, audits, replays.
--   E. Club request with proposed profile: pending (nothing applied); approve
--      applies sports fields + roster jersey number when free (taken -> empty
--      + reviewer told; paid programme -> on confirmation); DOB -> staff
--      review; coach sees sports fields only; decline applies nothing; audit.
--   F. Profile history: admin only.
--   G. Cross-tenant denial for the new table and every new RPC.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3 = coach
-- row …011). Org B 10000000-…0002 (seed_tenants.sql). SYNTHETIC DATA ONLY.
-- Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema ma;
grant usage on schema ma to authenticated, anon, service_role;
create table ma.ctx (k text primary key, v text);
grant all on ma.ctx to authenticated, anon, service_role;

create function ma.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function ma.put(p_k text, p_v text) returns void language sql as $$
  insert into ma.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function ma.get(p_k text) returns uuid language sql stable as $$ select v::uuid from ma.ctx where k = p_k $$;
create function ma.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
create function ma.j(p_res text) returns jsonb language sql immutable as $$
  select case when p_res like 'OK:%' and p_res <> 'OK:<null>' then substr(p_res, 4)::jsonb end
$$;
grant execute on all functions in schema ma to authenticated, anon, service_role;

-- Shortcut: run as a key from ma.ctx.
create function ma.as_(p_who text, p_sql text) returns text language sql as $$ select ma.run_as(ma.get(p_who), p_sql) $$;
grant execute on all functions in schema ma to authenticated, anon, service_role;

-- Fixtures -----------------------------------------------------------------------
-- G     guardian of family F (K1, K2; later "Myself" S)
-- G2    guardian of family F2 (K3, and DUP = an admin-created duplicate of K3)
-- C2U   second coach (coach row C2 on team T2)
-- ADULT login whose name + e-mail match adult player AP (family F4) -> self-link candidate
-- K4    child of family F3 that has no guardian
-- BA    admin of org B
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000ab0a1', 'ma-guardian@example.test'),
  ('00000000-0000-0000-0000-0000000ab0a2', 'ma-guardian-two@example.test'),
  ('00000000-0000-0000-0000-0000000ab0a3', 'ma-coach-two@example.test'),
  ('00000000-0000-0000-0000-0000000ab0a4', 'ma-adult-player@example.test'),
  ('b0000000-0000-0000-0000-0000000ab0f1', 'ma-admin-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Guardian'
 where id = '00000000-0000-0000-0000-0000000ab0a1';
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Guardian Two'
 where id = '00000000-0000-0000-0000-0000000ab0a2';
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Coach Two'
 where id = '00000000-0000-0000-0000-0000000ab0a3';
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Adultplayer'
 where id = '00000000-0000-0000-0000-0000000ab0a4';
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000ab0f1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab0a3', 'coach'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000ab0f1', 'admin');
insert into public.coaches (id, org_id, profile_id, display_name) values
  ('00000000-0000-0000-0000-0000000ab0c9', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab0a3', 'Synthetic Coach Two');

insert into public.families (id, org_id, name, contact_email) values
  ('00000000-0000-0000-0000-0000000ab061', '00000000-0000-0000-0000-000000000001', 'Synthetic MA Family', 'ma-guardian@example.test'),
  ('00000000-0000-0000-0000-0000000ab062', '00000000-0000-0000-0000-000000000001', 'Synthetic MA Family Two', 'ma-guardian-two@example.test'),
  ('00000000-0000-0000-0000-0000000ab063', '00000000-0000-0000-0000-000000000001', 'Synthetic MA No Guardian', null),
  ('00000000-0000-0000-0000-0000000ab064', '00000000-0000-0000-0000-000000000001', 'Synthetic MA Adult', 'MA-Adult-Player@example.test');
insert into public.family_members (family_id, profile_id, relation, is_primary) values
  ('00000000-0000-0000-0000-0000000ab061', '00000000-0000-0000-0000-0000000ab0a1', 'mother', true),
  ('00000000-0000-0000-0000-0000000ab062', '00000000-0000-0000-0000-0000000ab0a2', 'father', true);

insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, gender, status) values
  ('00000000-0000-0000-0000-0000000ab071', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab061', 'Synthetic', 'Maone', '2013-04-04', 'male', 'active'),
  ('00000000-0000-0000-0000-0000000ab072', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab061', 'Synthetic', 'Matwo', '2014-05-05', 'female', 'active'),
  ('00000000-0000-0000-0000-0000000ab073', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab062', 'Synthetic', 'Mathree', '2012-06-06', 'male', 'active'),
  ('00000000-0000-0000-0000-0000000ab074', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab063', 'Synthetic', 'Mafour', '2015-07-07', 'female', 'active'),
  ('00000000-0000-0000-0000-0000000ab075', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab064', 'Synthetic', 'Adultplayer', '1990-08-08', 'male', 'active');
-- An admin-created duplicate of K3 (same name + DOB, accents / case differ) in the same family.
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, gender, status, created_at) values
  ('00000000-0000-0000-0000-0000000ab076', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab062', 'SYNTHETIC', 'Mathrée', '2012-06-06', 'male', 'active', now() + interval '1 second');
-- Org B athlete.
insert into public.families (id, org_id, name) values ('b0000000-0000-0000-0000-0000000ab061', '10000000-0000-0000-0000-000000000002', 'Synthetic B Family');
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, gender, status) values
  ('b0000000-0000-0000-0000-0000000ab071', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000ab061', 'Synthetic', 'Bkid', '2013-04-04', 'male', 'active');

insert into public.teams (id, org_id, name, sport) values
  ('00000000-0000-0000-0000-0000000ab0e1', '00000000-0000-0000-0000-000000000001', 'Synthetic MA U12', 'basketball'),
  ('00000000-0000-0000-0000-0000000ab0e2', '00000000-0000-0000-0000-000000000001', 'Synthetic MA U14', 'basketball');
insert into public.team_coaches (team_id, coach_id, org_id) values
  ('00000000-0000-0000-0000-0000000ab0e1', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000ab0e2', '00000000-0000-0000-0000-0000000ab0c9', '00000000-0000-0000-0000-000000000001');
insert into public.team_memberships (org_id, team_id, athlete_id, jersey_number) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab0e1', '00000000-0000-0000-0000-0000000ab071', 4),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab0e2', '00000000-0000-0000-0000-0000000ab073', 9),
  -- the duplicate: one team the kept athlete is not on, one he is on (conflict)
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab0e1', '00000000-0000-0000-0000-0000000ab076', 5),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab0e2', '00000000-0000-0000-0000-0000000ab076', null);
insert into public.member_cards (org_id, athlete_id, nonce) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab073', md5('ma-card-k3')),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab076', md5('ma-card-dup'));
insert into public.athlete_medical (org_id, athlete_id, allergies) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab071', 'Synthetic allergy');

-- A clinic with a session led by coach …011 (registration-based coach access),
-- a free and a paid club team (club approval on by default).
insert into public.programs (id, org_id, slug, name, kind, price_chf, capacity, is_public, is_active, status, currency) values
  ('00000000-0000-0000-0000-0000000ab043', '00000000-0000-0000-0000-000000000001', 'ma-clinic', 'Synthetic MA Clinic', 'clinic', 0, null, false, true, 'published', 'CHF'),
  ('00000000-0000-0000-0000-0000000ab041', '00000000-0000-0000-0000-000000000001', 'ma-free', 'Synthetic MA Free Team', 'recurring_team', 0, null, false, true, 'published', 'CHF'),
  ('00000000-0000-0000-0000-0000000ab042', '00000000-0000-0000-0000-000000000001', 'ma-paid', 'Synthetic MA Paid Team', 'recurring_team', 100, null, false, true, 'published', 'CHF');
insert into public.program_sessions (id, org_id, program_id, coach_id, starts_at, location) values
  ('00000000-0000-0000-0000-0000000ab0d1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab043',
   '00000000-0000-0000-0000-000000000011', now() + interval '10 days', 'Synthetic Hall');
insert into public.registrations (id, org_id, athlete_id, program_id, status) values
  ('00000000-0000-0000-0000-0000000ab0b1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab072', '00000000-0000-0000-0000-0000000ab043', 'pending'),
  ('00000000-0000-0000-0000-0000000ab0b2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab076', '00000000-0000-0000-0000-0000000ab043', 'confirmed');
insert into public.teams (id, org_id, program_id, name, is_active) values
  ('00000000-0000-0000-0000-0000000ab0e3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab041', 'Synthetic MA Free squad', true),
  ('00000000-0000-0000-0000-0000000ab0e4', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab042', 'Synthetic MA Paid squad', true);
insert into public.team_coaches (team_id, coach_id, org_id, role) values
  ('00000000-0000-0000-0000-0000000ab0e3', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'head'),
  ('00000000-0000-0000-0000-0000000ab0e4', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'head');
-- Jersey 10 is already worn on the free squad.
insert into public.team_memberships (org_id, team_id, athlete_id, jersey_number) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ab0e3', '00000000-0000-0000-0000-0000000ab075', 10);

select ma.put('G', '00000000-0000-0000-0000-0000000ab0a1'), ma.put('G2', '00000000-0000-0000-0000-0000000ab0a2'),
       ma.put('C2U', '00000000-0000-0000-0000-0000000ab0a3'), ma.put('ADULT', '00000000-0000-0000-0000-0000000ab0a4'),
       ma.put('BA', 'b0000000-0000-0000-0000-0000000ab0f1'),
       ma.put('ADMIN', '00000000-0000-0000-0000-0000000000f1'), ma.put('FINANCE', '00000000-0000-0000-0000-0000000000f2'),
       ma.put('COACH', '00000000-0000-0000-0000-0000000000f3'),
       ma.put('K1', '00000000-0000-0000-0000-0000000ab071'), ma.put('K2', '00000000-0000-0000-0000-0000000ab072'),
       ma.put('K3', '00000000-0000-0000-0000-0000000ab073'), ma.put('K4', '00000000-0000-0000-0000-0000000ab074'),
       ma.put('AP', '00000000-0000-0000-0000-0000000ab075'), ma.put('DUP', '00000000-0000-0000-0000-0000000ab076'),
       ma.put('BK', 'b0000000-0000-0000-0000-0000000ab071'),
       ma.put('T1', '00000000-0000-0000-0000-0000000ab0e1'), ma.put('T2', '00000000-0000-0000-0000-0000000ab0e2'),
       ma.put('TF', '00000000-0000-0000-0000-0000000ab0e3'), ma.put('TP', '00000000-0000-0000-0000-0000000ab0e4'),
       ma.put('PFREE', '00000000-0000-0000-0000-0000000ab041'), ma.put('PPAID', '00000000-0000-0000-0000-0000000ab042'),
       ma.put('REG_K2', '00000000-0000-0000-0000-0000000ab0b1'), ma.put('REG_DUP', '00000000-0000-0000-0000-0000000ab0b2');

-- ===========================================================================
-- A. My athletes + active-athlete validation
-- ===========================================================================
do $$
declare r text; v jsonb; v_self uuid;
begin
  r := ma.as_('G', $q$select public.participant_self_ensure('{"first_name":"Synthetic","last_name":"Parentself","dob":"1985-01-01"}'::jsonb, gen_random_uuid())::text$q$);
  v_self := (ma.j(r)->>'athlete_id')::uuid;
  perform ma.ok(v_self is not null, 'setup: "Myself" profile for the guardian (' || r || ')');
  perform ma.put('S', v_self::text);

  v := ma.j(ma.as_('G', 'select public.my_athletes()::text'));
  perform ma.ok(jsonb_array_length(v) = 3, 'my athletes: self + two children listed (' || coalesce(jsonb_array_length(v), -1) || ')');
  perform ma.ok(v->0->>'kind' = 'self' and (v->0->>'id')::uuid = v_self, 'my athletes: own self profile first');
  perform ma.ok(exists (select 1 from jsonb_array_elements(v) e where (e->>'id')::uuid = ma.get('K1') and e->>'kind' = 'child')
                and exists (select 1 from jsonb_array_elements(v) e where (e->>'id')::uuid = ma.get('K2')),
                'my athletes: both children of the family listed');
  perform ma.ok(exists (select 1 from jsonb_array_elements(v) e, jsonb_array_elements(e->'teams') t
                         where (e->>'id')::uuid = ma.get('K1') and (t->>'id')::uuid = ma.get('T1')),
                'my athletes: active team shown for the child');
  perform ma.ok(exists (select 1 from jsonb_array_elements(v) e, jsonb_array_elements(e->'programmes') p
                         where (e->>'id')::uuid = ma.get('K2') and p->>'status' = 'pending'),
                'my athletes: live programme registration with its status (next step)');
  perform ma.ok(not exists (select 1 from jsonb_array_elements(v) e where (e->>'id')::uuid in (ma.get('K3'), ma.get('DUP'), ma.get('BK'))),
                'my athletes: never another family''s or club''s athlete');

  perform ma.ok(ma.as_('G', format('select public.my_athlete_resolve(%L)::text', ma.get('K2'))) = 'OK:' || ma.get('K2')::text,
                'switcher: own child accepted');
  perform ma.ok(ma.as_('G', format('select public.my_athlete_resolve(%L)::text', v_self)) = 'OK:' || v_self::text,
                'switcher: own self profile accepted');
  perform ma.ok(ma.as_('G', format('select public.my_athlete_resolve(%L)::text', ma.get('K3'))) = 'OK:<null>',
                'switcher: another family''s athlete id ignored');
  perform ma.ok(ma.as_('G', format('select public.my_athlete_resolve(%L)::text', ma.get('BK'))) = 'OK:<null>',
                'switcher: another club''s athlete id ignored');
  perform ma.ok(ma.as_('G', 'select public.my_athlete_resolve(gen_random_uuid())::text') = 'OK:<null>',
                'switcher: unknown (stale) id ignored');
  r := ma.run_as(null, format('select public.my_athlete_resolve(%L)::text', ma.get('K1')));
  perform ma.ok(r like 'ERR:%' or r = 'OK:<null>', 'switcher: anonymous caller gets nothing');

  v := ma.j(ma.as_('G2', 'select public.my_athletes()::text'));
  perform ma.ok(jsonb_array_length(v) = 2, 'my athletes: the other parent sees only their own family (two, incl. the duplicate)');
  perform ma.ok(ma.as_('ADMIN', 'select jsonb_array_length(public.my_athletes())::text') = 'OK:0',
                'my athletes: staff without a family get an empty list (not every athlete)');
end $$;

-- ===========================================================================
-- B. Coach: confirmed players of own teams / sessions only; sports-only writes
-- ===========================================================================
do $$
declare r text;
begin
  perform ma.ok(ma.as_('COACH', format('select count(*)::text from public.athletes where id = %L', ma.get('K1'))) = 'OK:1',
                'coach: reads a player of their own team');
  perform ma.ok(ma.as_('COACH', format('select count(*)::text from public.athletes where id = %L', ma.get('K3'))) = 'OK:0',
                'coach: no access to another team''s player');
  perform ma.ok(ma.as_('COACH', format('select count(*)::text from public.athletes where id = %L', ma.get('K2'))) = 'OK:0',
                'coach: no access to a child whose registration is not confirmed');
  update public.registrations set status = 'confirmed' where id = ma.get('REG_K2');
  perform ma.ok(ma.as_('COACH', format('select count(*)::text from public.athletes where id = %L', ma.get('K2'))) = 'OK:1',
                'coach: access once the registration is confirmed');

  r := ma.as_('COACH', format($q$select public.participant_update_sports(%L, '{"height_cm":"160"}'::jsonb)::text$q$, ma.get('K1')));
  perform ma.ok(r like 'OK:%' and (select height_cm from public.athletes where id = ma.get('K1')) = 160, 'coach: edits a sports field of own player');
  r := ma.as_('COACH', format($q$select public.participant_update_sports(%L, '{"height_cm":"161"}'::jsonb)::text$q$, ma.get('K3')));
  perform ma.ok(r like 'ERR:NOT_ALLOWED%', 'coach: cannot edit another team''s player (' || r || ')');
  r := ma.as_('COACH', format($q$select public.participant_update_sports(%L, '{"dob":"2013-01-01"}'::jsonb)::text$q$, ma.get('K1')));
  perform ma.ok(r like 'ERR:FIELD_NOT_ALLOWED%', 'coach: DOB is not a sports field');
  r := ma.as_('COACH', format($q$select public.participant_update(%L, '{"first_name":"Changed"}'::jsonb, null)::text$q$, ma.get('K1')));
  perform ma.ok(r like 'ERR:NOT_ALLOWED%', 'coach: no general profile edit');
  r := ma.as_('COACH', format($q$update public.athletes set first_name = 'Changed' where id = %L returning id::text$q$, ma.get('K1')));
  perform ma.ok((select first_name from public.athletes where id = ma.get('K1')) = 'Synthetic', 'coach: direct table update changes nothing');
  perform ma.ok(ma.as_('COACH', format('select public.participant_sports_profile(%L)::text', ma.get('K3'))) = 'OK:<null>',
                'coach: no sports profile of another team''s player');
end $$;

-- ===========================================================================
-- C. Finance: billing only
-- ===========================================================================
do $$
declare r text;
begin
  perform ma.ok(ma.as_('FINANCE', format('select count(*)::text from public.athlete_medical where athlete_id = %L', ma.get('K1'))) = 'OK:0',
                'finance: no medical data');
  perform ma.ok(ma.as_('FINANCE', format('select public.participant_sports_profile(%L)::text', ma.get('K1'))) = 'OK:<null>',
                'finance: no sports profile');
  r := ma.as_('FINANCE', format($q$select public.participant_update(%L, '{"first_name":"Changed"}'::jsonb, null)::text$q$, ma.get('K1')));
  perform ma.ok(r like 'ERR:NOT_ALLOWED%', 'finance: profile edit RPC refused (' || r || ')');
  r := ma.as_('FINANCE', format($q$select public.participant_update_sports(%L, '{"height_cm":"170"}'::jsonb)::text$q$, ma.get('K1')));
  perform ma.ok(r like 'ERR:NOT_ALLOWED%', 'finance: sports edit RPC refused');
  r := ma.as_('FINANCE', format($q$update public.athletes set height_cm = 170 where id = %L returning id::text$q$, ma.get('K1')));
  perform ma.ok(r like 'ERR:FIELD_NOT_ALLOWED%', 'finance: direct profile update refused (' || r || ')');
  perform ma.ok((select height_cm from public.athletes where id = ma.get('K1')) = 160, 'finance: profile unchanged');
  r := ma.as_('FINANCE', format('select public.athlete_profile_history(%L)::text', ma.get('K1')));
  perform ma.ok(r like 'ERR:NOT_ALLOWED%', 'finance: no profile history');
  perform ma.ok(ma.as_('FINANCE', format('select count(*)::text from public.athletes where id = %L', ma.get('K1'))) = 'OK:1',
                'finance: still reads the athlete for billing');
  r := ma.as_('FINANCE', 'select public.athlete_merge(gen_random_uuid(), gen_random_uuid(), null, gen_random_uuid())::text');
  perform ma.ok(r like 'ERR:NOT_ALLOWED%', 'finance: cannot merge athletes');
  r := ma.as_('FINANCE', 'select public.athlete_data_check()::text');
  perform ma.ok(r like 'ERR:NOT_ALLOWED%', 'finance: cannot run the athlete data check');
end $$;

-- ===========================================================================
-- D. Duplicate prevention, data check, self link, merge
-- ===========================================================================
do $$
declare r text; v jsonb; n int; v_flag uuid; v_req uuid := gen_random_uuid(); v_merge jsonb;
begin
  -- Same parent adds the same child again -> the same athlete.
  r := ma.as_('G', $q$select public.participant_create('{"first_name":"synthetic","last_name":"MAONE","dob":"2013-04-04","gender":"male"}'::jsonb, gen_random_uuid())::text$q$);
  perform ma.ok((ma.j(r)->>'athlete_id')::uuid = ma.get('K1') and ma.j(r)->>'existing' = 'true',
                'duplicates: the same parent adding the same child gets the existing athlete');
  -- Another family types an existing child: opaque match, link request, no duplicate.
  r := ma.as_('G2', $q$select public.participant_create('{"first_name":"Synthetic","last_name":"Maone","dob":"2013-04-04","gender":"male"}'::jsonb, gen_random_uuid())::text$q$);
  perform ma.ok(ma.j(r) = '{"ok": false, "code": "POSSIBLE_MATCH"}'::jsonb, 'duplicates: another family gets an opaque POSSIBLE_MATCH (' || r || ')');
  r := ma.as_('G2', $q$select public.participant_link_request('{"first_name":"Synthetic","last_name":"Maone","dob":"2013-04-04","relation":"father"}'::jsonb, gen_random_uuid())::text$q$);
  perform ma.ok(ma.j(r)->>'ok' = 'true' and not (ma.j(r) ? 'athlete_id'), 'duplicates: link request created without revealing the record');
  select count(*) into n from public.athletes where last_name = 'Maone';
  perform ma.ok(n = 1, 'duplicates: still one athlete');

  -- Data check (admin).
  r := ma.as_('ADMIN', 'select public.athlete_data_check()::text');
  v := ma.j(r);
  perform ma.ok(v is not null and (v->>'total')::int >= 3, 'data check: runs for admins (' || r || ')');
  select id into v_flag from public.data_review_flags
   where entity_id = ma.get('DUP') and reason_code = 'POSSIBLE_DUPLICATE' and resolved_at is null;
  perform ma.ok(v_flag is not null, 'data check: newer same-name + DOB athlete flagged POSSIBLE_DUPLICATE (normalised accents / case)');
  perform ma.ok(not exists (select 1 from public.data_review_flags where entity_id = ma.get('K3') and reason_code = 'POSSIBLE_DUPLICATE'),
                'data check: the oldest record of the group is not flagged');
  perform ma.ok(exists (select 1 from public.data_review_flags where entity_id = ma.get('AP') and reason_code = 'POSSIBLE_SELF_LINK'
                         and (details->>'profile_id')::uuid = ma.get('ADULT')),
                'data check: adult player matching a login by family e-mail + name flagged POSSIBLE_SELF_LINK');
  perform ma.ok((select player_profile_id from public.athletes where id = ma.get('AP')) is null, 'data check: never links automatically');
  perform ma.ok(exists (select 1 from public.data_review_flags where entity_id = ma.get('K4') and reason_code = 'ATHLETE_WITHOUT_GUARDIAN' and resolved_at is null),
                'data check: athlete without any guardian flagged');
  perform ma.ok(not exists (select 1 from public.data_review_flags where entity_id in (ma.get('K1'), ma.get('K2')) and reason_code = 'ATHLETE_WITHOUT_GUARDIAN'),
                'data check: athletes with a guardian are not flagged');
  r := ma.as_('ADMIN', 'select public.athlete_data_check()::text');
  perform ma.ok((ma.j(r)->>'possible_duplicates')::int = 0 and (ma.j(r)->>'possible_self_links')::int = 0 and (ma.j(r)->>'without_guardian')::int = 0,
                'data check: idempotent (no new flags on a re-run)');

  -- Self link only on staff confirmation.
  select id into v_flag from public.data_review_flags where entity_id = ma.get('AP') and reason_code = 'POSSIBLE_SELF_LINK';
  r := ma.as_('G', format('select public.athlete_self_link_decide(%L, %L)::text', v_flag, 'link'));
  perform ma.ok(r like 'ERR:NOT_ALLOWED%', 'self link: a parent cannot confirm');
  r := ma.as_('ADMIN', format('select public.athlete_self_link_decide(%L, %L)::text', v_flag, 'link'));
  perform ma.ok((select player_profile_id from public.athletes where id = ma.get('AP')) = ma.get('ADULT'),
                'self link: staff confirmation links the adult player to their login (' || r || ')');
  perform ma.ok((select resolved_at is not null from public.data_review_flags where id = v_flag), 'self link: flag resolved');

  -- Duplicate pairs + merge permissions.
  v := ma.j(ma.as_('ADMIN', 'select public.athlete_duplicate_pairs()::text'));
  perform ma.ok(exists (select 1 from jsonb_array_elements(v) e where (e->'athlete'->>'id')::uuid = ma.get('DUP') and (e->'match'->>'id')::uuid = ma.get('K3')),
                'merge: duplicate pair listed side by side for staff');
  r := ma.as_('COACH', format('select public.athlete_merge(%L, %L, null, gen_random_uuid())::text', ma.get('K3'), ma.get('DUP')));
  perform ma.ok(r like 'ERR:NOT_ALLOWED%', 'merge: coach refused');
  r := ma.as_('G2', format('select public.athlete_merge(%L, %L, null, gen_random_uuid())::text', ma.get('K3'), ma.get('DUP')));
  perform ma.ok(r like 'ERR:NOT_ALLOWED%', 'merge: guardian refused');
  r := ma.as_('BA', format('select public.athlete_merge(%L, %L, null, gen_random_uuid())::text', ma.get('K3'), ma.get('DUP')));
  perform ma.ok(r like 'ERR:NOT_FOUND%', 'merge: another club''s admin refused (not found)');
  r := ma.as_('ADMIN', format('select public.athlete_merge(%L, %L, null, gen_random_uuid())::text', ma.get('K3'), ma.get('BK')));
  perform ma.ok(r like 'ERR:NOT_FOUND%', 'merge: cross-club pair refused');
  r := ma.as_('ADMIN', format('select public.athlete_merge(%L, %L, null, gen_random_uuid())::text', ma.get('K3'), ma.get('K3')));
  perform ma.ok(r like 'ERR:INVALID_MERGE%', 'merge: an athlete cannot be merged into itself');

  -- Merge (admin).
  r := ma.as_('ADMIN', format('select public.athlete_merge(%L, %L, %L, %L)::text', ma.get('K3'), ma.get('DUP'), 'Synthetic duplicate', v_req));
  v_merge := ma.j(r);
  perform ma.ok(v_merge->>'ok' = 'true', 'merge: done (' || left(r, 200) || ')');
  perform ma.ok(exists (select 1 from public.team_memberships where team_id = ma.get('T1') and athlete_id = ma.get('K3') and jersey_number = 5),
                'merge: team membership of the duplicate moved to the kept athlete (jersey kept)');
  perform ma.ok((select athlete_id from public.registrations where id = ma.get('REG_DUP')) = ma.get('K3'),
                'merge: registration moved to the kept athlete');
  perform ma.ok((select count(*) from public.team_memberships where team_id = ma.get('T2') and athlete_id = ma.get('K3')) = 1
                and (select jersey_number from public.team_memberships where team_id = ma.get('T2') and athlete_id = ma.get('K3')) = 9,
                'merge: unique conflict keeps the kept athlete''s team row');
  perform ma.ok(exists (select 1 from jsonb_array_elements(v_merge->'conflicts') c where c->>'table' = 'team_memberships')
                and exists (select 1 from jsonb_array_elements(v_merge->'conflicts') c where c->>'table' = 'member_cards'),
                'merge: conflicts recorded (team membership, member card)');
  perform ma.ok((select status = 'archived' and merged_into_id = ma.get('K3') from public.athletes where id = ma.get('DUP')),
                'merge: duplicate archived and pointing to the kept athlete');
  perform ma.ok(exists (select 1 from public.athletes where id = ma.get('DUP')), 'merge: duplicate never deleted');
  perform ma.ok((select count(*) from public.athlete_merges where request_id = v_req) = 1, 'merge: logged once');
  perform ma.ok(exists (select 1 from public.audit_logs where action = 'athlete.merge.kept' and target_id = ma.get('K3'))
                and exists (select 1 from public.audit_logs where action = 'athlete.merge.archived' and target_id = ma.get('DUP')),
                'merge: audited on both athletes');
  perform ma.ok(not exists (select 1 from public.data_review_flags where entity_id = ma.get('DUP') and reason_code = 'POSSIBLE_DUPLICATE' and resolved_at is null),
                'merge: duplicate flag resolved');
  r := ma.as_('ADMIN', format('select public.athlete_merge(%L, %L, null, %L)::text', ma.get('K3'), ma.get('DUP'), v_req));
  perform ma.ok(ma.j(r)->>'replayed' = 'true' and (select count(*) from public.athlete_merges) = 1, 'merge: same request id replays');
  r := ma.as_('ADMIN', format('select public.athlete_merge(%L, %L, null, gen_random_uuid())::text', ma.get('K3'), ma.get('DUP')));
  perform ma.ok(r like 'ERR:ALREADY_MERGED%', 'merge: a merged duplicate cannot be merged again');
  v := ma.j(ma.as_('G2', 'select public.my_athletes()::text'));
  perform ma.ok(jsonb_array_length(v) = 1 and (v->0->>'id')::uuid = ma.get('K3'), 'merge: the family now sees one athlete');
  perform ma.ok(ma.as_('ADMIN', 'select count(*)::text from public.athlete_merges') = 'OK:1', 'merge log: admins read it');
  perform ma.ok(ma.as_('G2', 'select count(*)::text from public.athlete_merges') = 'OK:0', 'merge log: families do not');
  r := ma.as_('ADMIN', format($q$insert into public.athlete_merges (org_id, kept_athlete_id) values (%L, %L) returning id::text$q$,
                              '00000000-0000-0000-0000-000000000001', ma.get('K1')));
  perform ma.ok(r like 'ERR:%', 'merge log: no direct writes, even for admins');
end $$;

-- ===========================================================================
-- E. Club request with proposed profile details
-- ===========================================================================
do $$
declare r text; v jsonb; v_id uuid; v_id2 uuid; v_id3 uuid; v_id4 uuid; v_rid uuid := gen_random_uuid(); n int;
begin
  -- Invalid key: nothing is created.
  r := ma.as_('G', format($q$select public.club_request_submit(jsonb_build_object('kind','program_registration','athlete_id',%L,'program_id',%L,
                 'profile', '{"allergies":"x"}'::jsonb), %L)::text$q$, ma.get('K1'), ma.get('PFREE'), v_rid));
  perform ma.ok(r like 'ERR:FIELD_NOT_ALLOWED%', 'proposal: only profile fields accepted (' || r || ')');
  perform ma.ok(not exists (select 1 from public.club_approval_requests where request_id = v_rid), 'proposal: a refused proposal creates no request');

  -- K1 -> free team, proposes sports fields + jersey 23 (family_id derived from the athlete).
  r := ma.as_('G', format($q$select public.club_request_submit(jsonb_build_object('kind','program_registration','athlete_id',%L,'program_id',%L,
                 'profile', '{"height_cm":"152","weight_kg":"41","position_pref":"Guard","jersey_size":"M","preferred_jersey_number":"23"}'::jsonb), gen_random_uuid())::text$q$,
                 ma.get('K1'), ma.get('PFREE')));
  v := ma.j(r); v_id := (v->>'id')::uuid;
  perform ma.ok(v_id is not null and v->'proposed_profile'->'sports'->>'preferred_jersey_number' = '23', 'proposal: stored with the request (' || left(r, 160) || ')');
  perform ma.ok((select height_cm from public.athletes where id = ma.get('K1')) = 160 and (select position_pref from public.athletes where id = ma.get('K1')) is null,
                'proposal: nothing applied while pending');

  -- Reviewer views: coach sports only, admin everything.
  v := ma.j(ma.as_('COACH', 'select public.club_request_queue(''open'')::text'));
  perform ma.ok(exists (select 1 from jsonb_array_elements(v) e where (e->>'id')::uuid = v_id
                         and (e->'profile'->'proposed'->'sports'->>'height_cm')::numeric = 152 and (e->'profile'->'current'->>'height_cm')::numeric = 160),
                'review: assigned coach sees current vs proposed sports values');

  -- Approve (assigned coach): applied at once + roster number.
  r := ma.as_('COACH', format('select public.club_request_decide(%L, %L, null, gen_random_uuid())::text', v_id, 'approve'));
  v := ma.j(r);
  perform ma.ok(v->'profile'->>'status' = 'approved', 'approve: proposal applied (' || left(r, 300) || ')');
  perform ma.ok((select height_cm = 152 and weight_kg = 41 and position_pref = 'Guard' and jersey_size = 'M' and preferred_jersey_number = 23
                   from public.athletes where id = ma.get('K1')), 'approve: confirmed values on the athlete profile');
  perform ma.ok((select jersey_number from public.team_memberships where team_id = ma.get('TF') and athlete_id = ma.get('K1')) = 23,
                'approve: preferred number on the new roster row (free on that team)');
  perform ma.ok(v->'profile'->'jersey'->>'status' = 'assigned', 'approve: reviewer told the number was assigned');
  perform ma.ok(exists (select 1 from public.audit_logs where action = 'athlete.profile.proposal.approved' and target_id = ma.get('K1')),
                'approve: audited (proposal approved)');
  perform ma.ok(exists (select 1 from public.audit_logs where action = 'athlete.profile.changed' and target_id = ma.get('K1')
                         and new_data->'_meta'->>'via' = 'club_approval' and (old_data->>'height_cm')::numeric = 160 and (new_data->>'height_cm')::numeric = 152),
                'approve: field changes audited with before / after and the path');
  r := ma.as_('COACH', format('select public.club_request_decide(%L, %L, null, gen_random_uuid())::text', v_id, 'approve'));
  select count(*) into n from public.audit_logs where action = 'athlete.profile.proposal.approved' and target_id = ma.get('K1');
  perform ma.ok(n = 1, 'approve: a replay applies nothing twice');
  -- Same confirmed values in every portal read.
  perform ma.ok((ma.j(ma.as_('G', format('select public.participant_sports_profile(%L)::text', ma.get('K1'))))->>'height_cm')::numeric = 152
                and (ma.j(ma.as_('COACH', format('select public.participant_sports_profile(%L)::text', ma.get('K1'))))->>'height_cm')::numeric = 152
                and ma.as_('ADMIN', format('select height_cm::text from public.athletes where id = %L', ma.get('K1'))) = 'OK:152.0',
                'sync: parent, coach and admin read the same confirmed values');

  -- K2 -> free team with number 10 (already worn): roster number stays empty.
  r := ma.as_('G', format($q$select public.club_request_submit(jsonb_build_object('kind','program_registration','athlete_id',%L,'program_id',%L,
                 'profile', '{"preferred_jersey_number":"10"}'::jsonb), gen_random_uuid())::text$q$, ma.get('K2'), ma.get('PFREE')));
  v_id2 := (ma.j(r)->>'id')::uuid;
  r := ma.as_('ADMIN', format('select public.club_request_decide(%L, %L, null, gen_random_uuid())::text', v_id2, 'approve'));
  v := ma.j(r);
  perform ma.ok(v->'profile'->'jersey'->>'status' = 'taken', 'approve: taken number reported to the reviewer (' || left(r, 200) || ')');
  perform ma.ok((select jersey_number from public.team_memberships where team_id = ma.get('TF') and athlete_id = ma.get('K2')) is null,
                'approve: roster number left empty when the number is taken');
  perform ma.ok((select preferred_jersey_number from public.athletes where id = ma.get('K2')) = 10, 'approve: the preference itself is saved on the profile');

  -- K2 -> paid team: DOB correction + height + number 7 (reserved until paid).
  r := ma.as_('G', format($q$select public.club_request_submit(jsonb_build_object('kind','program_registration','athlete_id',%L,'program_id',%L,
                 'profile', '{"dob":"2014-03-03","height_cm":"140","preferred_jersey_number":"7"}'::jsonb), gen_random_uuid())::text$q$, ma.get('K2'), ma.get('PPAID')));
  v_id3 := (ma.j(r)->>'id')::uuid;
  perform ma.ok(v_id3 is not null, 'proposal: DOB correction submitted with the request (' || left(r, 120) || ')');
  v := ma.j(ma.as_('COACH', 'select public.club_request_queue(''open'')::text'));
  perform ma.ok(exists (select 1 from jsonb_array_elements(v) e where (e->>'id')::uuid = v_id3 and e->'profile'->'proposed' ? 'sports'
                         and not (e->'profile'->'proposed' ? 'eligibility') and not (e->'profile'->'current' ? 'dob')),
                'review: coach never sees the DOB / sex proposal');
  v := ma.j(ma.as_('ADMIN', 'select public.club_request_queue(''open'')::text'));
  perform ma.ok(exists (select 1 from jsonb_array_elements(v) e where (e->>'id')::uuid = v_id3
                         and e->'profile'->'proposed'->'eligibility'->>'dob' = '2014-03-03' and e->'profile'->'current'->>'dob' = '2014-05-05'),
                'review: admin sees current vs proposed DOB');
  r := ma.as_('ADMIN', format('select public.club_request_decide(%L, %L, null, gen_random_uuid())::text', v_id3, 'approve'));
  v := ma.j(r);
  perform ma.ok((select height_cm from public.athletes where id = ma.get('K2')) = 140, 'approve: sports field applied (' || left(r, 200) || ')');
  perform ma.ok((select dob from public.athletes where id = ma.get('K2')) = '2014-05-05', 'approve: DOB not changed by the approval itself');
  perform ma.ok(exists (select 1 from public.athlete_change_requests where athlete_id = ma.get('K2') and status = 'pending' and changes->>'dob' = '2014-03-03')
                and v->'profile'->'eligibility'->>'status' = 'review_pending',
                'approve: DOB correction goes to the staff review (athlete_change_requests)');
  perform ma.ok(v->'profile'->'jersey'->>'status' = 'reserved', 'approve (paid): number reserved until the registration is confirmed');
  -- Payment confirms the registration -> roster row + number.
  update public.registrations set status = 'confirmed' where id = (select registration_id from public.club_approval_requests where id = v_id3);
  perform ma.ok((select jersey_number from public.team_memberships where team_id = ma.get('TP') and athlete_id = ma.get('K2')) = 7,
                'confirmation: reserved number put on the new roster row');
  perform ma.ok((select profile_outcome->'jersey'->>'status' from public.club_approval_requests where id = v_id3) = 'assigned',
                'confirmation: outcome updated for the reviewer');
  -- Staff approve the correction -> applied.
  r := ma.as_('ADMIN', format('select public.participant_change_decide(%L, %L)::text',
                              (select id from public.athlete_change_requests where athlete_id = ma.get('K2') and status = 'pending'), 'approve'));
  perform ma.ok((select dob from public.athletes where id = ma.get('K2')) = '2014-03-03', 'correction: applied once staff approve (' || r || ')');

  -- Decline: nothing changes.
  r := ma.as_('G', format($q$select public.club_request_submit(jsonb_build_object('kind','program_registration','athlete_id',%L,'program_id',%L,
                 'profile', '{"height_cm":"999"}'::jsonb), gen_random_uuid())::text$q$, ma.get('K1'), ma.get('PPAID')));
  perform ma.ok(r like 'ERR:INVALID_HEIGHT%', 'proposal: values validated');
  r := ma.as_('G', format($q$select public.club_request_submit(jsonb_build_object('kind','program_registration','athlete_id',%L,'program_id',%L,
                 'profile', '{"height_cm":"170"}'::jsonb), gen_random_uuid())::text$q$, ma.get('K1'), ma.get('PPAID')));
  v_id4 := (ma.j(r)->>'id')::uuid;
  r := ma.as_('ADMIN', format('select public.club_request_decide(%L, %L, %L, gen_random_uuid())::text', v_id4, 'decline', 'Synthetic decline'));
  perform ma.ok(ma.j(r)->'profile'->>'status' = 'declined', 'decline: outcome recorded');
  perform ma.ok((select height_cm from public.athletes where id = ma.get('K1')) = 152, 'decline: nothing applied');
  perform ma.ok(exists (select 1 from public.audit_logs where action = 'athlete.profile.proposal.declined' and target_id = ma.get('K1')),
                'decline: audited');
  v := ma.j(ma.as_('G', 'select public.club_request_family_list()::text'));
  perform ma.ok(exists (select 1 from jsonb_array_elements(v) e where (e->>'id')::uuid = v_id4 and e->'profile'->'outcome'->>'status' = 'declined'),
                'family: sees the outcome of the proposal');
  perform ma.ok(ma.as_('COACH', format('select jersey_number::text from public.team_memberships where team_id = %L and athlete_id = %L', ma.get('TF'), ma.get('K1'))) = 'OK:23',
                'sync: coach reads the roster number');
end $$;

-- ===========================================================================
-- F. Profile history: admin only
-- ===========================================================================
do $$
declare r text; v jsonb;
begin
  v := ma.j(ma.as_('ADMIN', format('select public.athlete_profile_history(%L)::text', ma.get('K1'))));
  perform ma.ok(jsonb_array_length(v) >= 3, 'history: admin reads the athlete''s profile events');
  perform ma.ok(exists (select 1 from jsonb_array_elements(v) e where e->>'action' = 'athlete.profile.changed'
                         and (e->'before'->>'height_cm')::numeric = 160 and (e->'after'->>'height_cm')::numeric = 152 and e->>'via' = 'club_approval'),
                'history: before / after and path of a change');
  perform ma.ok(exists (select 1 from jsonb_array_elements(v) e where e->>'action' = 'athlete.profile.created'), 'history: creation listed');
  perform ma.ok(exists (select 1 from jsonb_array_elements(v) e where e->>'action' = 'athlete.profile.changed' and e->>'via' = 'coach'),
                'history: coach sports edit listed with its path');
  perform ma.ok(exists (select 1 from jsonb_array_elements(v) e where e->>'action' = 'athlete.profile.proposal.declined'), 'history: decline listed');
  v := ma.j(ma.as_('ADMIN', format('select public.athlete_profile_history(%L)::text', ma.get('K2'))));
  perform ma.ok(exists (select 1 from jsonb_array_elements(v) e where e->>'action' = 'athlete.profile.correction.requested')
                and exists (select 1 from jsonb_array_elements(v) e where e->>'action' = 'athlete.profile.correction.approved'),
                'history: DOB correction requested and approved');
  v := ma.j(ma.as_('ADMIN', format('select public.athlete_profile_history(%L)::text', ma.get('K3'))));
  perform ma.ok(exists (select 1 from jsonb_array_elements(v) e where e->>'action' = 'athlete.merge.kept'), 'history: merge listed');
  r := ma.as_('COACH', format('select public.athlete_profile_history(%L)::text', ma.get('K1')));
  perform ma.ok(r like 'ERR:NOT_ALLOWED%', 'history: coach refused');
  r := ma.as_('G', format('select public.athlete_profile_history(%L)::text', ma.get('K1')));
  perform ma.ok(r like 'ERR:NOT_ALLOWED%', 'history: parent refused');
end $$;

-- ===========================================================================
-- G. Cross-tenant denial
-- ===========================================================================
do $$
declare r text; v jsonb; n0 int; n1 int; v_flag uuid; v_req uuid;
begin
  perform ma.ok(ma.as_('BA', 'select jsonb_array_length(public.my_athletes())::text') = 'OK:0', 'cross-tenant: my_athletes empty for another club');
  perform ma.ok(ma.as_('BA', format('select public.my_athlete_resolve(%L)::text', ma.get('K1'))) = 'OK:<null>', 'cross-tenant: switcher ignores another club''s id');
  r := ma.as_('BA', format('select public.athlete_profile_history(%L)::text', ma.get('K1')));
  perform ma.ok(r like 'ERR:NOT_ALLOWED%', 'cross-tenant: profile history refused');
  perform ma.ok(ma.as_('BA', 'select count(*)::text from public.athlete_merges') = 'OK:0', 'cross-tenant: merge log not readable');
  v := ma.j(ma.as_('BA', 'select public.athlete_duplicate_pairs()::text'));
  perform ma.ok(not exists (select 1 from jsonb_array_elements(v) e
                             where (e->'athlete'->>'id')::uuid in (select id from public.athletes where org_id = '00000000-0000-0000-0000-000000000001')),
                'cross-tenant: duplicate pairs only of the own club');
  select count(*) into n0 from public.data_review_flags where org_id = '00000000-0000-0000-0000-000000000001';
  r := ma.as_('BA', 'select public.athlete_data_check()::text');
  select count(*) into n1 from public.data_review_flags where org_id = '00000000-0000-0000-0000-000000000001';
  perform ma.ok(r like 'OK:%' and n0 = n1, 'cross-tenant: data check of another club touches nothing here');
  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  values ('00000000-0000-0000-0000-000000000001', 'athletes', ma.get('K4'), 'POSSIBLE_SELF_LINK',
          jsonb_build_object('athlete_id', ma.get('K4'), 'profile_id', ma.get('G')))
  returning id into v_flag;
  r := ma.as_('BA', format('select public.athlete_self_link_decide(%L, %L)::text', v_flag, 'link'));
  perform ma.ok(r like 'ERR:NOT_FOUND%', 'cross-tenant: self-link decision refused');
  select id into v_req from public.club_approval_requests where athlete_id = ma.get('K1') limit 1;
  r := ma.as_('BA', format('select public.club_request_decide(%L, %L, null, gen_random_uuid())::text', v_req, 'decline'));
  perform ma.ok(r like 'ERR:%', 'cross-tenant: club request decision refused');
  r := ma.as_('BA', format($q$select public.club_request_submit(jsonb_build_object('kind','program_registration','athlete_id',%L,'program_id',%L,
                 'profile','{"height_cm":"150"}'::jsonb), gen_random_uuid())::text$q$, ma.get('K1'), ma.get('PFREE')));
  perform ma.ok(r like 'ERR:%', 'cross-tenant: cannot submit for another club''s athlete');
  r := ma.as_('BA', format($q$select public.participant_update_sports(%L, '{"height_cm":"150"}'::jsonb)::text$q$, ma.get('K1')));
  perform ma.ok(r like 'ERR:NOT_FOUND%', 'cross-tenant: profile write refused');
  perform ma.ok((select height_cm from public.athletes where id = ma.get('K1')) = 152, 'cross-tenant: profile unchanged');
end $$;
