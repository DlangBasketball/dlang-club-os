-- ============================================================================
-- Coach management suite (migration 20250420100000_coach_management.sql)
--
--   A. coaches table: org A admin reads, creates and edits coaches; a guardian
--      and a coach read but cannot write; org B admin can neither read nor
--      edit org A coaches, and cannot create one inside org A.
--   B. coach-photos bucket: private; admin writes; the linked coach writes
--      only their own folder; members of the org (guardian, finance, coach)
--      read; org B admin can neither read nor write org A photos; anonymous
--      callers read nothing; malformed keys are refused.
--   C. coaches.photo_path must sit under <org_id>/<coach_id>/; set_coach_photo
--      is admin-or-self and org-scoped.
--   D. coach_usage / delete_coach_if_unused: referenced coaches are kept,
--      unreferenced ones are deleted, both only inside the caller's org.
--   E. Audit: coach edits are written to audit_logs with the actor.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach Derrick
-- …f3 = coach …011, guardian Carla …f4), coach …012 (no login). Org B …0002
-- is created by seed_tenants.sql; its admin and coach are created here.
-- SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema ca;
grant usage on schema ca to authenticated, anon, service_role;

create function ca.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p (null = anon). Returns 'OK:<first column>' or 'ERR:<message>'.
create function ca.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
grant execute on all functions in schema ca to authenticated, anon, service_role;

-- Org B: admin + a coach (synthetic).
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000c1', 'admin-b@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id = 'b0000000-0000-0000-0000-0000000000c1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000c1', 'admin');
insert into public.coaches (id, org_id, display_name, role_title) values
  ('b0000000-0000-0000-0000-0000000000c9', '10000000-0000-0000-0000-000000000002', 'Synthetic B coach', 'Head coach');

-- ===========================================================================
-- A. coaches table
-- ===========================================================================
do $$
declare v text;
begin
  v := ca.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select count(*)::text from public.coaches where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform ca.ok(v <> 'OK:0' and v like 'OK:%', 'org A admin lists org A coaches (' || v || ')');

  v := ca.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.coaches (id, org_id, display_name, role_title, bio)
          values ('a0000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-000000000001', 'Synthetic New Coach', 'Assistant', 'Synthetic bio')
          returning id::text$q$);
  perform ca.ok(v like 'OK:%', 'org A admin creates a coach (' || v || ')');

  v := ca.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.coaches set display_name = 'Coach Michael R.', role_title = 'Skills', is_active = false
                     where id = '00000000-0000-0000-0000-000000000012' returning 1) select count(*)::text from u$q$);
  perform ca.ok(v = 'OK:1', 'org A admin edits / deactivates a coach (' || v || ')');
  perform ca.ok((select display_name = 'Coach Michael R.' and not is_active from public.coaches where id = '00000000-0000-0000-0000-000000000012'),
                'coach edit persisted');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.coaches set is_active = true where id = '00000000-0000-0000-0000-000000000012' returning 1) select count(*)::text from u$q$);
  perform ca.ok(v = 'OK:1', 'org A admin reactivates a coach');

  v := ca.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select count(*)::text from public.coaches where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform ca.ok(v <> 'OK:0' and v like 'OK:%', 'guardian of org A sees the club''s coaches (' || v || ')');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$with u as (update public.coaches set display_name = 'Hacked' where id = '00000000-0000-0000-0000-000000000012' returning 1) select count(*)::text from u$q$);
  perform ca.ok(v = 'OK:0', 'guardian cannot edit a coach (' || v || ')');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$with u as (update public.coaches set display_name = 'Self rename', is_active = false where id = '00000000-0000-0000-0000-000000000011' returning 1) select count(*)::text from u$q$);
  perform ca.ok(v = 'OK:0', 'a coach cannot edit their own coach row directly (' || v || ')');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$insert into public.coaches (org_id, display_name) values ('00000000-0000-0000-0000-000000000001', 'Finance coach') returning id::text$q$);
  perform ca.ok(v like 'ERR:%', 'finance cannot create a coach');

  -- Cross-tenant denial.
  v := ca.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$select count(*)::text from public.coaches where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform ca.ok(v = 'OK:0', 'org B admin cannot read org A coaches (' || v || ')');
  v := ca.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$with u as (update public.coaches set display_name = 'Taken over' where id = '00000000-0000-0000-0000-000000000012' returning 1) select count(*)::text from u$q$);
  perform ca.ok(v = 'OK:0', 'org B admin cannot edit an org A coach (' || v || ')');
  v := ca.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$with d as (delete from public.coaches where id = '00000000-0000-0000-0000-000000000012' returning 1) select count(*)::text from d$q$);
  perform ca.ok(v = 'OK:0', 'org B admin cannot delete an org A coach (' || v || ')');
  v := ca.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$insert into public.coaches (org_id, display_name) values ('00000000-0000-0000-0000-000000000001', 'Planted') returning id::text$q$);
  perform ca.ok(v like 'ERR:%', 'org B admin cannot create a coach inside org A');
  v := ca.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$select count(*)::text from public.coaches where org_id = '10000000-0000-0000-0000-000000000002'$q$);
  perform ca.ok(v = 'OK:1', 'org B admin reads its own coach (' || v || ')');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select count(*)::text from public.coaches where org_id = '10000000-0000-0000-0000-000000000002'$q$);
  perform ca.ok(v = 'OK:0', 'org A admin cannot read org B coaches (' || v || ')');
end $$;

-- ===========================================================================
-- B. Storage: coach-photos
-- ===========================================================================
do $$
declare v text;
  k11 text := '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000011/p1.jpg';
  k12 text := '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000012/p1.jpg';
  kb  text := '10000000-0000-0000-0000-000000000002/b0000000-0000-0000-0000-0000000000c9/p1.jpg';
begin
  perform ca.ok((select public = false from storage.buckets where id = 'coach-photos'), 'coach-photos bucket exists and is private');

  v := ca.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$insert into storage.objects (bucket_id, name) values ('coach-photos', %L) returning name$q$, k12));
  perform ca.ok(v like 'OK:%', 'org A admin uploads a coach photo (' || v || ')');

  v := ca.run_as('00000000-0000-0000-0000-0000000000f3',
       format($q$insert into storage.objects (bucket_id, name) values ('coach-photos', %L) returning name$q$, k11));
  perform ca.ok(v like 'OK:%', 'linked coach uploads their own photo (' || v || ')');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f3',
       format($q$insert into storage.objects (bucket_id, name) values ('coach-photos', %L) returning name$q$,
              '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000012/x.jpg'));
  perform ca.ok(v like 'ERR:%', 'a coach cannot upload another coach''s photo');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f3',
       format($q$with d as (delete from storage.objects where bucket_id = 'coach-photos' and name = %L returning 1) select count(*)::text from d$q$, k12));
  perform ca.ok(v = 'OK:0', 'a coach cannot delete another coach''s photo (' || v || ')');

  v := ca.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select count(*)::text from storage.objects where bucket_id = 'coach-photos'$q$);
  perform ca.ok(v = 'OK:2', 'guardian of org A sees the coaches'' photos (' || v || ')');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$insert into storage.objects (bucket_id, name) values ('coach-photos', %L) returning name$q$,
              '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000012/g.jpg'));
  perform ca.ok(v like 'ERR:%', 'guardian cannot upload a coach photo');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$select count(*)::text from storage.objects where bucket_id = 'coach-photos'$q$);
  perform ca.ok(v = 'OK:2', 'finance staff of org A sees the coaches'' photos (' || v || ')');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f2',
       format($q$insert into storage.objects (bucket_id, name) values ('coach-photos', %L) returning name$q$,
              '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000012/f.jpg'));
  perform ca.ok(v like 'ERR:%', 'finance cannot upload a coach photo');

  v := ca.run_as(null, $q$select count(*)::text from storage.objects where bucket_id = 'coach-photos'$q$);
  perform ca.ok(v in ('OK:0') or v like 'ERR:%', 'anonymous caller reads no coach photo (' || v || ')');

  -- Cross-tenant denial.
  v := ca.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$select count(*)::text from storage.objects where bucket_id = 'coach-photos'$q$);
  perform ca.ok(v = 'OK:0', 'org B admin cannot read org A coach photos (' || v || ')');
  v := ca.run_as('b0000000-0000-0000-0000-0000000000c1',
       format($q$insert into storage.objects (bucket_id, name) values ('coach-photos', %L) returning name$q$,
              '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000012/b.jpg'));
  perform ca.ok(v like 'ERR:%', 'org B admin cannot upload into an org A coach folder');
  v := ca.run_as('b0000000-0000-0000-0000-0000000000c1',
       format($q$insert into storage.objects (bucket_id, name) values ('coach-photos', %L) returning name$q$,
              '10000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-000000000012/b.jpg'));
  perform ca.ok(v like 'ERR:%', 'org B admin cannot file an org A coach under its own org folder');
  v := ca.run_as('b0000000-0000-0000-0000-0000000000c1',
       format($q$with d as (delete from storage.objects where bucket_id = 'coach-photos' and name = %L returning 1) select count(*)::text from d$q$, k12));
  perform ca.ok(v = 'OK:0', 'org B admin cannot delete an org A coach photo (' || v || ')');
  v := ca.run_as('b0000000-0000-0000-0000-0000000000c1',
       format($q$insert into storage.objects (bucket_id, name) values ('coach-photos', %L) returning name$q$, kb));
  perform ca.ok(v like 'OK:%', 'org B admin uploads a photo of its own coach (' || v || ')');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select count(*)::text from storage.objects where bucket_id = 'coach-photos' and name = %L$q$, kb));
  perform ca.ok(v = 'OK:0', 'org A guardian cannot read org B coach photos (' || v || ')');

  -- Malformed keys.
  v := ca.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into storage.objects (bucket_id, name) values ('coach-photos', '00000000-0000-0000-0000-000000000001/flat.jpg') returning name$q$);
  perform ca.ok(v like 'ERR:%', 'a key without the coach folder is refused');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into storage.objects (bucket_id, name) values ('coach-photos', '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000012/a/b.jpg') returning name$q$);
  perform ca.ok(v like 'ERR:%', 'a nested key is refused');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into storage.objects (bucket_id, name) values ('coach-photos', '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000099/a.jpg') returning name$q$);
  perform ca.ok(v like 'ERR:%', 'a key for an unknown coach is refused');

  v := ca.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$with d as (delete from storage.objects where bucket_id = 'coach-photos' and name = %L returning 1) select count(*)::text from d$q$, k12));
  perform ca.ok(v = 'OK:1', 'org A admin removes a coach photo (' || v || ')');
end $$;

-- ===========================================================================
-- C. photo_path scope + set_coach_photo
-- ===========================================================================
do $$
declare v text;
begin
  v := ca.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select coalesce(public.set_coach_photo('00000000-0000-0000-0000-000000000012',
            '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000012/p2.jpg'), 'none')$q$);
  perform ca.ok(v = 'OK:none', 'admin sets a coach photo path (' || v || ')');
  perform ca.ok((select photo_path like '%/p2.jpg' and photo_updated_at is not null from public.coaches where id = '00000000-0000-0000-0000-000000000012'),
                'photo path and timestamp stored');

  v := ca.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select public.set_coach_photo('00000000-0000-0000-0000-000000000012',
            '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000011/p2.jpg')$q$);
  perform ca.ok(v like 'ERR:%INVALID_PATH%', 'a path under another coach is refused (' || v || ')');

  v := ca.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.coaches set photo_path = '10000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-000000000012/x.jpg'
                     where id = '00000000-0000-0000-0000-000000000012' returning 1) select count(*)::text from u$q$);
  perform ca.ok(v like 'ERR:%coaches_photo_path_scope%', 'photo_path outside the coach folder violates the check (' || v || ')');

  v := ca.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select coalesce(public.set_coach_photo('00000000-0000-0000-0000-000000000011',
            '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000011/p1.jpg'), 'none')$q$);
  perform ca.ok(v like 'OK:%', 'linked coach sets their own photo (' || v || ')');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select public.set_coach_photo('00000000-0000-0000-0000-000000000012', null)$q$);
  perform ca.ok(v like 'ERR:%FORBIDDEN%', 'a coach cannot change another coach''s photo (' || v || ')');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.set_coach_photo('00000000-0000-0000-0000-000000000012', null)$q$);
  perform ca.ok(v like 'ERR:%FORBIDDEN%', 'a guardian cannot change a coach photo (' || v || ')');

  -- Cross-tenant denial.
  v := ca.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$select public.set_coach_photo('00000000-0000-0000-0000-000000000012', null)$q$);
  perform ca.ok(v like 'ERR:%NOT_FOUND%', 'org B admin cannot change an org A coach photo (' || v || ')');
  perform ca.ok((select photo_path is not null from public.coaches where id = '00000000-0000-0000-0000-000000000012'),
                'org A coach photo untouched');
  v := ca.run_as(null, $q$select public.set_coach_photo('00000000-0000-0000-0000-000000000012', null)$q$);
  perform ca.ok(v like 'ERR:%', 'anonymous caller cannot call set_coach_photo');
end $$;

-- ===========================================================================
-- D. Usage + safe delete
-- ===========================================================================
do $$
declare v text; v_usage jsonb;
begin
  -- Derrick (…011) is referenced (availability / bookings / sessions in seed).
  v := ca.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.coach_usage('00000000-0000-0000-0000-000000000011')::text$q$);
  perform ca.ok(v like 'OK:%', 'admin reads coach usage (' || v || ')');
  v_usage := substr(v, 4)::jsonb;
  perform ca.ok((select sum(value::bigint) from jsonb_each_text(v_usage)) > 0, 'a coach with history has references');

  v := ca.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.delete_coach_if_unused('00000000-0000-0000-0000-000000000011')::text$q$);
  perform ca.ok(v like 'ERR:%COACH_IN_USE%', 'a referenced coach is not deleted (' || v || ')');
  perform ca.ok(exists (select 1 from public.coaches where id = '00000000-0000-0000-0000-000000000011'), 'referenced coach still present');

  -- Assign the new coach to a team, then remove: in use while assigned.
  insert into public.teams (id, org_id, name) values
    ('a0000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-000000000001', 'Synthetic coach-suite team');
  insert into public.team_coaches (team_id, coach_id, org_id, role) values
    ('a0000000-0000-0000-0000-0000000000e7', 'a0000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-000000000001', 'assistant');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f1', $q$select (public.coach_usage('a0000000-0000-0000-0000-0000000000c5')->>'teams')$q$);
  perform ca.ok(v = 'OK:1', 'usage counts the team assignment (' || v || ')');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.delete_coach_if_unused('a0000000-0000-0000-0000-0000000000c5')::text$q$);
  perform ca.ok(v like 'ERR:%COACH_IN_USE%', 'a coach assigned to a team is not deleted (' || v || ')');
  delete from public.team_coaches where coach_id = 'a0000000-0000-0000-0000-0000000000c5';

  v := ca.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.delete_coach_if_unused('a0000000-0000-0000-0000-0000000000c5')::text$q$);
  perform ca.ok(v like 'ERR:%FORBIDDEN%', 'finance cannot delete a coach (' || v || ')');

  -- Cross-tenant denial.
  v := ca.run_as('b0000000-0000-0000-0000-0000000000c1', $q$select public.coach_usage('a0000000-0000-0000-0000-0000000000c5')::text$q$);
  perform ca.ok(v like 'ERR:%NOT_FOUND%', 'org B admin cannot read org A coach usage (' || v || ')');
  v := ca.run_as('b0000000-0000-0000-0000-0000000000c1', $q$select public.delete_coach_if_unused('a0000000-0000-0000-0000-0000000000c5')::text$q$);
  perform ca.ok(v like 'ERR:%NOT_FOUND%', 'org B admin cannot delete an org A coach (' || v || ')');
  perform ca.ok(exists (select 1 from public.coaches where id = 'a0000000-0000-0000-0000-0000000000c5'), 'org A coach survives the cross-tenant attempt');

  v := ca.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.delete_coach_if_unused('a0000000-0000-0000-0000-0000000000c5')::text$q$);
  perform ca.ok(v like 'OK:%"deleted": true%', 'an unreferenced coach is deleted (' || v || ')');
  perform ca.ok(not exists (select 1 from public.coaches where id = 'a0000000-0000-0000-0000-0000000000c5'), 'deleted coach is gone');
end $$;

-- ===========================================================================
-- E. Audit
-- ===========================================================================
do $$
declare v text;
begin
  perform ca.ok(exists (select 1 from public.audit_logs where target_table = 'coaches'
                          and target_id = '00000000-0000-0000-0000-000000000012' and action = 'UPDATE'
                          and actor_id = '00000000-0000-0000-0000-0000000000f1'),
                'coach edit is audited with the actor');
  perform ca.ok(exists (select 1 from public.audit_logs where target_table = 'coaches'
                          and target_id = 'a0000000-0000-0000-0000-0000000000c5' and action = 'DELETE'),
                'coach delete is audited');
  v := ca.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$select count(*)::text from public.audit_logs where target_table = 'coaches' and org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform ca.ok(v = 'OK:0', 'org B admin reads no org A coach audit rows (' || v || ')');
end $$;
