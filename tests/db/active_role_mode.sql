-- ============================================================================
-- Role switcher (migrations 20250420107000_active_role_mode.sql, 20250420107100_active_role_mode_scopes.sql)
--
--   M. Multi-role person (admin + coach + guardian): available modes, first
--      state initialises the default mode, switching, what each mode allows
--      (has_role / is_admin / is_finance / coach scope / guardian scope),
--      direct API calls (RLS) follow the mode, invalid modes refused.
--   S. Single-role people: no stored mode, behaviour unchanged.
--   R. Revocation: a stored mode whose role is gone stops counting; the next
--      state call moves the person to a mode they still hold.
--   A. Audit: switches are logged; changes record the acting mode (trigger
--      path and server/service-role path).
--   T. Isolation: the mode table is private and written only through RPCs;
--      another club is unaffected.
-- Fixtures: synthetic only (ids …a9…).
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema arm;
grant usage on schema arm to authenticated, anon, service_role;
create function arm.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function arm.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    execute 'set local role authenticated';
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
grant execute on all functions in schema arm to authenticated, anon, service_role;

-- a901 multi-role founder (admin + coach + guardian), a902 admin only, a903 coach only, a904 parent only, a991 org B admin.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a901', 'arm-founder@example.test'),
  ('00000000-0000-0000-0000-00000000a902', 'arm-admin@example.test'),
  ('00000000-0000-0000-0000-00000000a903', 'arm-coach@example.test'),
  ('00000000-0000-0000-0000-00000000a904', 'arm-parent@example.test'),
  ('b0000000-0000-0000-0000-00000000a991', 'arm-admin-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001' where id::text like '00000000-0000-0000-0000-00000000a9%';
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-00000000a991';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a901', 'admin'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a901', 'coach'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a902', 'admin'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a903', 'coach'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000a991', 'admin');
insert into public.coaches (id, org_id, display_name, profile_id) values
  ('00000000-0000-0000-0000-00000000a951', '00000000-0000-0000-0000-000000000001', 'Synthetic Founder Coach', '00000000-0000-0000-0000-00000000a901');
insert into public.families (id, org_id, name) values
  ('00000000-0000-0000-0000-00000000a921', '00000000-0000-0000-0000-000000000001', 'Synthetic ARM Family'),
  ('00000000-0000-0000-0000-00000000a922', '00000000-0000-0000-0000-000000000001', 'Synthetic ARM Other Family');
insert into public.family_members (family_id, profile_id, relation, is_primary) values
  ('00000000-0000-0000-0000-00000000a921', '00000000-0000-0000-0000-00000000a901', 'guardian', true),
  ('00000000-0000-0000-0000-00000000a922', '00000000-0000-0000-0000-00000000a904', 'guardian', true);
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, status) values
  ('00000000-0000-0000-0000-00000000a931', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a921', 'Synth', 'Armkid', '2012-01-01', 'active'),
  ('00000000-0000-0000-0000-00000000a932', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a922', 'Synth', 'Armother', '2012-02-02', 'active');
insert into public.teams (id, org_id, name, sport) values
  ('00000000-0000-0000-0000-00000000a941', '00000000-0000-0000-0000-000000000001', 'ARM Coached Team', 'basketball'),
  ('00000000-0000-0000-0000-00000000a942', '00000000-0000-0000-0000-000000000001', 'ARM Other Team', 'basketball');
insert into public.team_coaches (team_id, coach_id, org_id, role) values
  ('00000000-0000-0000-0000-00000000a941', '00000000-0000-0000-0000-00000000a951', '00000000-0000-0000-0000-000000000001', 'head');
insert into public.team_memberships (org_id, team_id, athlete_id, status, joined_on) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a941', '00000000-0000-0000-0000-00000000a932', 'active', current_date - 10);

-- ===========================================================================
-- M / S. Modes
-- ===========================================================================
do $$
declare r text;
  f uuid := '00000000-0000-0000-0000-00000000a901';
  probe text := $q$select public.is_admin()::text || '/' || public.is_finance()::text || '/' || public.has_role('coach')::text || '/' || public.is_guardian_of_family('00000000-0000-0000-0000-00000000a921')::text$q$;
begin
  r := arm.run_as(f, 'select array_to_string(public.available_modes(), '','')');
  perform arm.ok(r = 'OK:admin,coach,parent', 'founder may use admin, coach and parent (' || r || ')');
  r := arm.run_as(f, probe);
  perform arm.ok(r = 'OK:true/true/true/true', 'before any switch nothing changes (' || r || ')');
  r := arm.run_as(f, $q$select public.active_mode_state('admin')::text$q$);
  perform arm.ok(r like 'OK:%"mode": "admin"%', 'first state call initialises the default mode (' || r || ')');
  perform arm.ok((select count(*) = 1 from public.user_active_modes where profile_id = f), 'mode stored (remembered across sessions)');
  r := arm.run_as(f, probe);
  perform arm.ok(r = 'OK:true/true/true/true', 'admin mode: admin, finance, coach and own family as before (' || r || ')');

  r := arm.run_as(f, $q$select public.set_active_mode('coach')::text$q$);
  perform arm.ok(r like 'OK:%"mode": "coach"%"previous": "admin"%', 'switch to coach (' || left(r, 90) || ')');
  r := arm.run_as(f, probe);
  perform arm.ok(r = 'OK:false/false/true/false', 'coach mode: no admin / finance powers, family scope off (' || r || ')');
  r := arm.run_as(f, 'select (public.current_coach_id() is not null)::text');
  perform arm.ok(r = 'OK:true', 'coach mode: coach record active');
  r := arm.run_as(f, 'select count(*)::text from public.staff_roles');
  perform arm.ok(r = 'OK:2', 'coach mode: direct API read of staff_roles shows only own rows (' || r || ')');
  r := arm.run_as(f, $q$select public.coach_coaches_team('00000000-0000-0000-0000-00000000a941')::text || '/' || public.coach_coaches_team('00000000-0000-0000-0000-00000000a942')::text$q$);
  perform arm.ok(r = 'OK:true/false', 'coach mode: assigned team only (' || r || ')');
  r := arm.run_as(f, $q$select count(*)::text from public.athletes where id in ('00000000-0000-0000-0000-00000000a931','00000000-0000-0000-0000-00000000a932')$q$);
  perform arm.ok(r = 'OK:1', 'coach mode: the coached team''s player only, not the own child (' || r || ')');
  r := arm.run_as(f, $q$select count(*)::text from public.athletes where id = '00000000-0000-0000-0000-00000000a931'$q$);
  perform arm.ok(r = 'OK:0', 'coach mode: own child''s record not readable (' || r || ')');
  r := arm.run_as(f, $q$update public.teams set name = 'hacked' where id = '00000000-0000-0000-0000-00000000a942' returning 1$q$);
  perform arm.ok(r = 'OK:<null>' and (select name = 'ARM Other Team' from public.teams where id = '00000000-0000-0000-0000-00000000a942'),
                 'coach mode: an admin write through the API is refused (' || r || ')');

  r := arm.run_as(f, $q$select public.set_active_mode('parent')::text$q$);
  r := arm.run_as(f, probe);
  perform arm.ok(r = 'OK:false/false/false/true', 'parent mode: only the family (' || r || ')');
  r := arm.run_as(f, 'select (public.current_coach_id() is null)::text');
  perform arm.ok(r = 'OK:true', 'parent mode: coach scope off');
  r := arm.run_as(f, $q$select public.coach_coaches_team('00000000-0000-0000-0000-00000000a941')::text$q$);
  perform arm.ok(r = 'OK:false', 'parent mode: no access to the coached team (' || r || ')');
  r := arm.run_as(f, $q$select string_agg(last_name, ',') from public.athletes where id in ('00000000-0000-0000-0000-00000000a931','00000000-0000-0000-0000-00000000a932')$q$);
  perform arm.ok(r = 'OK:Armkid', 'parent mode: own child only, not the coached player (' || r || ')');

  r := arm.run_as(f, $q$select public.set_active_mode('admin')::text$q$);
  r := arm.run_as(f, probe);
  perform arm.ok(r = 'OK:true/true/true/true', 'back to admin: admin functions restored (' || r || ')');
  r := arm.run_as(f, 'select count(*)::text from public.athletes where id in (''00000000-0000-0000-0000-00000000a931'',''00000000-0000-0000-0000-00000000a932'')');
  perform arm.ok(r = 'OK:2', 'admin mode: club-wide athletes again (' || r || ')');

  r := arm.run_as(f, $q$select public.set_active_mode('finance')::text$q$);
  perform arm.ok(r like 'ERR:%MODE_NOT_AVAILABLE%', 'unknown mode refused');
  r := arm.run_as('00000000-0000-0000-0000-00000000a902', $q$select public.set_active_mode('coach')::text$q$);
  perform arm.ok(r like 'ERR:%MODE_NOT_AVAILABLE%', 'a role you do not hold cannot be selected');
  r := arm.run_as(null, $q$select public.set_active_mode('admin')::text$q$);
  perform arm.ok(r like 'ERR:%', 'anonymous cannot set a mode');
end $$;

do $$
declare r text;
begin
  -- Single-role people: one mode, nothing stored, behaviour unchanged.
  r := arm.run_as('00000000-0000-0000-0000-00000000a902', $q$select public.active_mode_state('admin')::text || ' ' || public.is_admin()::text$q$);
  perform arm.ok(r like 'OK:%"mode": null%true', 'admin only: no mode stored, admin as before (' || r || ')');
  r := arm.run_as('00000000-0000-0000-0000-00000000a903', $q$select public.active_mode_state(null)::text || ' ' || public.has_role('coach')::text$q$);
  perform arm.ok(r like 'OK:%"mode": null%["coach"]%true', 'coach only: unchanged (' || r || ')');
  r := arm.run_as('00000000-0000-0000-0000-00000000a904', $q$select public.active_mode_state(null)::text$q$);
  perform arm.ok(r like 'OK:%"mode": null%["parent"]%', 'parent only: unchanged (' || r || ')');
  perform arm.ok((select count(*) = 0 from public.user_active_modes where profile_id in ('00000000-0000-0000-0000-00000000a902', '00000000-0000-0000-0000-00000000a903', '00000000-0000-0000-0000-00000000a904')),
                 'no mode rows for single-role people');
end $$;

-- ===========================================================================
-- R. Revocation
-- ===========================================================================
do $$
declare r text; f uuid := '00000000-0000-0000-0000-00000000a901';
begin
  r := arm.run_as(f, $q$select public.set_active_mode('coach')::text$q$);
  delete from public.staff_roles where profile_id = f and role = 'coach';
  r := arm.run_as(f, 'select coalesce(public.current_active_mode(), ''none'')');
  perform arm.ok(r = 'OK:none', 'coach role revoked: coach mode no longer counts (' || r || ')');
  r := arm.run_as(f, $q$select public.has_role('coach')::text$q$);
  perform arm.ok(r = 'OK:false', 'revoked role refused');
  r := arm.run_as(f, $q$select public.active_mode_state('coach')::text$q$);
  perform arm.ok(r like 'OK:%"mode": "admin"%', 'next state call moves to a mode still held (' || r || ')');
  r := arm.run_as(f, $q$select public.set_active_mode('coach')::text$q$);
  perform arm.ok(r like 'ERR:%MODE_NOT_AVAILABLE%', 'cannot switch back to the revoked mode');
  -- a coach-only person whose coach role is removed loses the coach scope too (coach record kept)
  insert into public.coaches (id, org_id, display_name, profile_id) values
    ('00000000-0000-0000-0000-00000000a953', '00000000-0000-0000-0000-000000000001', 'Synthetic Coach Only', '00000000-0000-0000-0000-00000000a903');
  r := arm.run_as('00000000-0000-0000-0000-00000000a903', 'select (public.current_coach_id() is not null)::text');
  perform arm.ok(r = 'OK:true', 'coach with the role: coach scope');
  delete from public.staff_roles where profile_id = '00000000-0000-0000-0000-00000000a903' and role = 'coach';
  r := arm.run_as('00000000-0000-0000-0000-00000000a903', 'select (public.current_coach_id() is not null)::text');
  perform arm.ok(r = 'OK:false', 'coach role revoked: the coach record no longer gives access (' || r || ')');
  insert into public.staff_roles (org_id, profile_id, role) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a903', 'coach');
  insert into public.staff_roles (org_id, profile_id, role) values ('00000000-0000-0000-0000-000000000001', f, 'coach');
end $$;

-- ===========================================================================
-- A. Audit
-- ===========================================================================
do $$
declare r text; f uuid := '00000000-0000-0000-0000-00000000a901';
begin
  perform arm.ok((select count(*) >= 4 from public.audit_logs where actor_id = f and action = 'role.mode.switch'), 'every switch is audited');
  r := arm.run_as(f, $q$select public.set_active_mode('admin')::text$q$);
  r := arm.run_as(f, $q$update public.teams set name = 'ARM Coached Team (renamed)' where id = '00000000-0000-0000-0000-00000000a941' returning 1$q$);
  perform arm.ok(r = 'OK:1', 'admin mode: admin renames a team');
  perform arm.ok((select acting_mode = 'admin' from public.audit_logs where target_id = '00000000-0000-0000-0000-00000000a941' and actor_id = f order by id desc limit 1),
                 'the audit row records the acting mode (admin)');
  r := arm.run_as(f, $q$select public.set_active_mode('coach')::text$q$);
  -- server path: service role writes an audit row with an explicit actor
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id)
  values ('00000000-0000-0000-0000-000000000001', f, 'synthetic.server.action', 'teams', '00000000-0000-0000-0000-00000000a941');
  perform arm.ok((select acting_mode = 'coach' from public.audit_logs where action = 'synthetic.server.action' order by id desc limit 1),
                 'server-written audit rows record the actor''s mode (coach)');
  insert into public.audit_logs (org_id, actor_id, action) values ('00000000-0000-0000-0000-000000000001', null, 'synthetic.system');
  perform arm.ok((select acting_mode is null from public.audit_logs where action = 'synthetic.system' order by id desc limit 1), 'system rows have no mode');
end $$;

-- ===========================================================================
-- T. Isolation
-- ===========================================================================
do $$
declare r text;
begin
  r := arm.run_as('00000000-0000-0000-0000-00000000a902', 'select count(*)::text from public.user_active_modes');
  perform arm.ok(r = 'OK:0', 'another admin cannot read someone''s mode (' || r || ')');
  r := arm.run_as('00000000-0000-0000-0000-00000000a901', $q$insert into public.user_active_modes (profile_id, org_id, mode) values ('00000000-0000-0000-0000-00000000a902', '00000000-0000-0000-0000-000000000001', 'coach') returning 1$q$);
  perform arm.ok(r like 'ERR:%', 'the mode table is written only through the RPC (' || left(r, 60) || ')');
  r := arm.run_as('00000000-0000-0000-0000-00000000a901', $q$update public.user_active_modes set mode = 'admin' returning 1$q$);
  perform arm.ok(r = 'OK:<null>', 'direct update ignored');
  r := arm.run_as('b0000000-0000-0000-0000-00000000a991', $q$select public.is_admin()::text || ' ' || array_to_string(public.available_modes(), ',')$q$);
  perform arm.ok(r = 'OK:true admin', 'other club admin unaffected (' || r || ')');
  r := arm.run_as('b0000000-0000-0000-0000-00000000a991', $q$select count(*)::text from public.athletes where id = '00000000-0000-0000-0000-00000000a931'$q$);
  perform arm.ok(r = 'OK:0', 'other club sees nothing of ours (' || r || ')');
end $$;
