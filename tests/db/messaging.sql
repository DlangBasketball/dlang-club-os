-- ============================================================================
-- Communication suite: message board, alerts, preferences, new contacts
-- (migration 20250420100700_messaging_alerts_leads.sql)
--
--   A. Permission matrix (msg_can_contact): who may message whom.
--   B. Starting threads: direct, office, refused pairs, thread reuse.
--   C. Reading: parents cannot read other families' threads; coaches cannot
--      read threads they are not in; admins can; finance only office threads.
--   D. Posting rules, office replies make the answering staff a participant.
--   E. Contact details are never selectable by the other party.
--   F. Channels: scope staff post, scope guardians read / reply per settings.
--   G. Moderation: hide, report abuse, no deletes, close thread.
--   H. Unread counts + read state.
--   I. Alerts: audiences, schedule, coach scope, recipients (server only).
--   J. Notification preferences: own row only.
--   K. Leads: server-only submission, consent, rate limit, admin inbox.
--   L. Attachments bucket: members only, hidden files, cross-tenant denial.
--   M. Cross-tenant denial for every new table and RPC; same-org guards.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach Derrick …f3
-- = coach …011 leading programme …043, guardian Carla …f4 of Mateo …071 in
-- programme …041). Family …062 (Lucas …072 + Sophia …073 in programme …043)
-- gets a guardian login here (…d2); coach …012 gets a login (…c2). Org B
-- …0002 from seed_tenants.sql gets an admin and a guardian.
-- SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema sc;
grant usage on schema sc to authenticated, anon, service_role;

create function sc.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p (null = anon). Returns 'OK:<first column>' or 'ERR:<message>'.
create function sc.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    perform set_config('request.jwt.claim.role', case when p is null then 'anon' else 'authenticated' end, true);
    if p is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
    execute p_sql into v_res;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    return 'OK:' || coalesce(v_res, '<null>');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;

-- Same, for statements that return no rows (writes without RETURNING).
create function sc.exec_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_n bigint;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    perform set_config('request.jwt.claim.role', case when p is null then 'anon' else 'authenticated' end, true);
    if p is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
    execute p_sql;
    get diagnostics v_n = row_count;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    return 'OK:' || v_n;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;
grant execute on all functions in schema sc to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000c2', 'coach2@example.test'),
  ('a0000000-0000-0000-0000-0000000000d2', 'guardian2@example.test'),
  ('a0000000-0000-0000-0000-0000000000e9', 'norole@example.test'),
  ('b0000000-0000-0000-0000-0000000000c1', 'admin-b@example.test'),
  ('b0000000-0000-0000-0000-0000000000d1', 'guardian-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Coach Two', phone = '+41 00 000 00 02'
 where id = 'a0000000-0000-0000-0000-0000000000c2';
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Guardian Two', phone = '+41 00 000 00 03'
 where id = 'a0000000-0000-0000-0000-0000000000d2';
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001' where id = 'a0000000-0000-0000-0000-0000000000e9';
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id in ('b0000000-0000-0000-0000-0000000000c1', 'b0000000-0000-0000-0000-0000000000d1');
update public.profiles set phone = '+41 00 000 00 01' where id = '00000000-0000-0000-0000-0000000000f3';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c2', 'coach'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000c1', 'admin');
update public.coaches set profile_id = 'a0000000-0000-0000-0000-0000000000c2'
 where id = '00000000-0000-0000-0000-000000000012';
insert into public.family_members (family_id, profile_id, relation, is_primary) values
  ('00000000-0000-0000-0000-000000000062', 'a0000000-0000-0000-0000-0000000000d2', 'father', true);
insert into public.families (id, org_id, name) values
  ('b0000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-000000000002', 'Synthetic B family');
insert into public.family_members (family_id, profile_id, relation, is_primary) values
  ('b0000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-0000000000d1', 'mother', true);

-- Shared ids between blocks.
create table sc.ids (k text primary key, val uuid);
grant all on sc.ids to authenticated, anon, service_role;

-- ===========================================================================
-- A. Permission matrix
-- ===========================================================================
do $$
declare v text;
begin
  -- guardian Müller (…d2) -> Derrick: Derrick coaches programme …043 of Lucas/Sophia
  v := sc.run_as('a0000000-0000-0000-0000-0000000000d2', $q$select public.msg_can_contact('00000000-0000-0000-0000-0000000000f3')::text$q$);
  perform sc.ok(v = 'OK:true', 'parent may message the coach of their child');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select public.msg_can_contact('00000000-0000-0000-0000-0000000000f3')::text$q$);
  perform sc.ok(v = 'OK:false', 'parent may not message a coach who does not coach their child');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select public.msg_can_contact('00000000-0000-0000-0000-0000000000f1')::text$q$);
  perform sc.ok(v = 'OK:true', 'parent may message the office (admin)');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select public.msg_can_contact('00000000-0000-0000-0000-0000000000f2')::text$q$);
  perform sc.ok(v = 'OK:true', 'parent may message the office (finance)');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select public.msg_can_contact('a0000000-0000-0000-0000-0000000000d2')::text$q$);
  perform sc.ok(v = 'OK:false', 'parent may never message another parent');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select public.msg_can_contact('a0000000-0000-0000-0000-0000000000d2')::text$q$);
  perform sc.ok(v = 'OK:true', 'coach may message guardians of athletes they coach');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select public.msg_can_contact('00000000-0000-0000-0000-0000000000f4')::text$q$);
  perform sc.ok(v = 'OK:false', 'coach may not message guardians of athletes they do not coach');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2', $q$select public.msg_can_contact('00000000-0000-0000-0000-0000000000f3')::text$q$);
  perform sc.ok(v = 'OK:true', 'coach may message another staff member');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.msg_can_contact('00000000-0000-0000-0000-0000000000f4')::text$q$);
  perform sc.ok(v = 'OK:true', 'admin may message any guardian');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.msg_can_contact('a0000000-0000-0000-0000-0000000000e9')::text$q$);
  perform sc.ok(v = 'OK:false', 'nobody may message an account that is neither staff nor guardian');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1', $q$select public.msg_can_contact('00000000-0000-0000-0000-0000000000f4')::text$q$);
  perform sc.ok(v = 'OK:false', 'another club''s admin may not message our guardian');
  v := sc.run_as(null, $q$select public.msg_can_contact('00000000-0000-0000-0000-0000000000f4')::text$q$);
  perform sc.ok(v like 'ERR:%', 'anonymous cannot use the messaging RPCs');
end $$;

-- ===========================================================================
-- B. Starting threads
-- ===========================================================================
do $$
declare v text; v_id uuid;
begin
  v := sc.run_as('a0000000-0000-0000-0000-0000000000d2',
       $q$select public.msg_start_direct('00000000-0000-0000-0000-0000000000f3', 'Synthetic question about practice')::text$q$);
  perform sc.ok(v like 'OK:%', 'parent starts a thread with their child''s coach (' || v || ')');
  v_id := substr(v, 4)::uuid;
  insert into sc.ids values ('coach_family', v_id);
  perform sc.ok((select family_id from public.msg_conversations where id = v_id) = '00000000-0000-0000-0000-000000000062',
                'thread is tied to the parent''s family');
  perform sc.ok((select count(*) from public.msg_participants where conversation_id = v_id) = 2, 'two participants');
  perform sc.ok((select sensitive from public.msg_conversations where id = v_id), 'direct threads are sensitive by default');

  v := sc.run_as('a0000000-0000-0000-0000-0000000000d2',
       $q$select public.msg_start_direct('00000000-0000-0000-0000-0000000000f3', 'Synthetic follow-up')::text$q$);
  perform sc.ok(v = 'OK:' || v_id::text, 'a second message without subject continues the open thread');

  v := sc.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.msg_start_direct('00000000-0000-0000-0000-0000000000f3', 'Synthetic text')::text$q$);
  perform sc.ok(v like 'ERR:%NOT_ALLOWED%', 'parent cannot start a thread with an unrelated coach');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.msg_start_direct('a0000000-0000-0000-0000-0000000000d2', 'Synthetic text')::text$q$);
  perform sc.ok(v like 'ERR:%NOT_ALLOWED%', 'parent cannot start a thread with another parent');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.msg_start_direct('00000000-0000-0000-0000-0000000000f3', '   ')::text$q$);
  perform sc.ok(v like 'ERR:%', 'empty message refused');

  v := sc.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.msg_start_direct(null, 'Synthetic billing question', 'Invoice')::text$q$);
  perform sc.ok(v like 'OK:%', 'parent writes to the club office');
  v_id := substr(v, 4)::uuid;
  insert into sc.ids values ('office', v_id);
  perform sc.ok((select office and family_id = '00000000-0000-0000-0000-000000000061' from public.msg_conversations where id = v_id),
                'office thread flagged and tied to the family');

  v := sc.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select public.msg_start_direct(null, 'Synthetic text')::text$q$);
  perform sc.ok(v like 'ERR:%NOT_ALLOWED%', 'staff cannot open an office thread');

  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2',
       $q$select public.msg_start_direct('00000000-0000-0000-0000-0000000000f3', 'Synthetic staff note', 'Staff')::text$q$);
  perform sc.ok(v like 'OK:%', 'coach starts a staff thread');
  insert into sc.ids values ('staff', substr(v, 4)::uuid);
  perform sc.ok((select family_id is null from public.msg_conversations where id = substr(v, 4)::uuid), 'staff thread has no family');

  -- Club switches off parent-started threads
  insert into public.messaging_settings (org_id, parents_can_start) values ('00000000-0000-0000-0000-000000000001', false);
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select public.msg_start_direct(null, 'Synthetic text', 'Again')::text$q$);
  perform sc.ok(v like 'ERR:%PARENT_START_DISABLED%', 'parents cannot start threads when the club turned it off');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select public.msg_start_direct('a0000000-0000-0000-0000-0000000000d2', 'Synthetic reply from coach', 'Coach note')::text$q$);
  perform sc.ok(v like 'OK:%', 'staff can still start threads with families');
  update public.messaging_settings set parents_can_start = true where org_id = '00000000-0000-0000-0000-000000000001';

  -- No direct writes to conversations / participants
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f4', $q$insert into public.msg_conversations (org_id, kind) values ('00000000-0000-0000-0000-000000000001', 'direct')$q$);
  perform sc.ok(v like 'ERR:%', 'no direct conversation inserts');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f4',
       format($q$insert into public.msg_participants (org_id, conversation_id, profile_id, side) values ('00000000-0000-0000-0000-000000000001', %L, '00000000-0000-0000-0000-0000000000f4', 'family')$q$,
              (select val from sc.ids where k = 'coach_family')));
  perform sc.ok(v like 'ERR:%', 'a parent cannot add themselves to another family''s thread');
end $$;

-- ===========================================================================
-- C. Reading
-- ===========================================================================
do $$
declare v text; v_cf uuid := (select val from sc.ids where k = 'coach_family'); v_off uuid := (select val from sc.ids where k = 'office');
        v_staff uuid := (select val from sc.ids where k = 'staff');
begin
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select count(*)::text from public.msg_conversations where id = %L$q$, v_cf));
  perform sc.ok(v = 'OK:0', 'parent cannot see another family''s thread');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select count(*)::text from public.msg_messages where conversation_id = %L$q$, v_cf));
  perform sc.ok(v = 'OK:0', 'parent cannot read another family''s messages');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select count(*)::text from public.msg_participants where conversation_id = %L$q$, v_cf));
  perform sc.ok(v = 'OK:0', 'parent cannot list another thread''s participants');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select count(*)::text from public.msg_people(%L)$q$, v_cf));
  perform sc.ok(v = 'OK:0', 'msg_people returns nothing for a thread the caller cannot read');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000d2', format($q$select count(*)::text from public.msg_messages where conversation_id = %L$q$, v_cf));
  perform sc.ok(v = 'OK:2', 'participant parent reads the thread');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', format($q$select count(*)::text from public.msg_messages where conversation_id = %L$q$, v_cf));
  perform sc.ok(v = 'OK:2', 'participant coach reads the thread');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2', format($q$select count(*)::text from public.msg_messages where conversation_id = %L$q$, v_cf));
  perform sc.ok(v = 'OK:0', 'a coach who is not in the thread cannot read it');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select count(*)::text from public.msg_messages where conversation_id = %L$q$, v_cf));
  perform sc.ok(v = 'OK:2', 'admin can read every staff <-> family thread');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select count(*)::text from public.msg_messages where conversation_id = %L$q$, v_cf));
  perform sc.ok(v = 'OK:0', 'finance cannot read coach <-> family threads');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select count(*)::text from public.msg_messages where conversation_id = %L$q$, v_off));
  perform sc.ok(v = 'OK:1', 'finance reads office threads');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', format($q$select count(*)::text from public.msg_messages where conversation_id = %L$q$, v_off));
  perform sc.ok(v = 'OK:0', 'a coach cannot read office threads');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000d2', format($q$select count(*)::text from public.msg_messages where conversation_id = %L$q$, v_staff));
  perform sc.ok(v = 'OK:0', 'a parent cannot read staff threads');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.msg_inbox(true)$q$);
  perform sc.ok(v = 'OK:1', 'parent''s inbox (even asking for all) lists only their own thread');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.msg_inbox(true)$q$);
  perform sc.ok(v = 'OK:4', 'admin oversight lists every thread of the club (' || v || ')');
end $$;

-- ===========================================================================
-- D. Posting
-- ===========================================================================
do $$
declare v text; v_cf uuid := (select val from sc.ids where k = 'coach_family'); v_off uuid := (select val from sc.ids where k = 'office');
begin
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f4',
       format($q$insert into public.msg_messages (org_id, conversation_id, sender_id, body) values ('00000000-0000-0000-0000-000000000001', %L, '00000000-0000-0000-0000-0000000000f4', 'Synthetic intrusion')$q$, v_cf));
  perform sc.ok(v like 'ERR:%', 'parent cannot post in another family''s thread');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f3',
       format($q$insert into public.msg_messages (org_id, conversation_id, sender_id, body) values ('00000000-0000-0000-0000-000000000001', %L, 'a0000000-0000-0000-0000-0000000000d2', 'Synthetic spoof')$q$, v_cf));
  perform sc.ok(v like 'ERR:%', 'nobody can post as someone else');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f3',
       format($q$insert into public.msg_messages (org_id, conversation_id, sender_id, body) values ('00000000-0000-0000-0000-000000000001', %L, '00000000-0000-0000-0000-0000000000f3', 'Synthetic answer')$q$, v_cf));
  perform sc.ok(v = 'OK:1', 'coach answers in the thread');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f2',
       format($q$insert into public.msg_messages (org_id, conversation_id, sender_id, body) values ('00000000-0000-0000-0000-000000000001', %L, '00000000-0000-0000-0000-0000000000f2', 'Synthetic office answer')$q$, v_off));
  perform sc.ok(v = 'OK:1', 'finance answers an office thread');
  perform sc.ok(exists (select 1 from public.msg_participants where conversation_id = v_off and profile_id = '00000000-0000-0000-0000-0000000000f2' and side = 'staff'),
                'the answering office member becomes a participant');
  v := sc.exec_as('a0000000-0000-0000-0000-0000000000c2',
       format($q$insert into public.msg_messages (org_id, conversation_id, sender_id, body) values ('00000000-0000-0000-0000-000000000001', %L, 'a0000000-0000-0000-0000-0000000000c2', 'Synthetic')$q$, v_cf));
  perform sc.ok(v like 'ERR:%', 'a coach outside the thread cannot post');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f3',
       format($q$update public.msg_messages set body = 'Synthetic edit' where conversation_id = %L$q$, v_cf));
  perform sc.ok(v = 'OK:0', 'non-admins cannot edit messages');
end $$;

-- ===========================================================================
-- E. Contact details are never exposed
-- ===========================================================================
do $$
declare v text; v_cf uuid := (select val from sc.ids where k = 'coach_family');
begin
  v := sc.run_as('a0000000-0000-0000-0000-0000000000d2', $q$select count(*)::text from public.profiles where id = '00000000-0000-0000-0000-0000000000f3'$q$);
  perform sc.ok(v = 'OK:0', 'parent cannot select the coach''s profile (email / phone)');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.profiles where id = 'a0000000-0000-0000-0000-0000000000d2'$q$);
  perform sc.ok(v = 'OK:0', 'coach cannot select the parent''s profile (email / phone)');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000d2', format($q$select string_agg(coalesce(display_name, '?'), ',' order by display_name) from public.msg_people(%L)$q$, v_cf));
  perform sc.ok(v = 'OK:Derrick Lang,Synthetic Guardian Two', 'msg_people returns display names (' || v || ')');
  perform sc.ok(pg_get_function_result('public.msg_people(uuid)'::regprocedure) !~* '(email|phone)', 'msg_people has no email / phone column');
  perform sc.ok(pg_get_function_result('public.msg_contacts()'::regprocedure) !~* '(email|phone)', 'msg_contacts has no email / phone column');
  perform sc.ok(pg_get_function_result('public.msg_inbox(boolean, integer)'::regprocedure) !~* '(email|phone)', 'msg_inbox has no email / phone column');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000d2', format($q$select (select row_to_json(p)::text from public.msg_people(%L) p limit 1)$q$, v_cf));
  perform sc.ok(v !~* '(@example|\+41)', 'no email or phone value leaks through msg_people');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.msg_contacts() where profile_id = 'a0000000-0000-0000-0000-0000000000d2'$q$);
  perform sc.ok(v = 'OK:0', 'other parents are not in a parent''s contact list');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.msg_contacts() where profile_id = 'a0000000-0000-0000-0000-0000000000d2'$q$);
  perform sc.ok(v = 'OK:1', 'coach sees the guardian of an athlete they coach in their contacts');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.msg_contacts() where profile_id = '00000000-0000-0000-0000-0000000000f4'$q$);
  perform sc.ok(v = 'OK:0', 'coach does not see unrelated guardians');
end $$;

-- ===========================================================================
-- F. Channels
-- ===========================================================================
do $$
declare v text; v_ch uuid;
begin
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select public.msg_start_channel('program', '00000000-0000-0000-0000-000000000043', 'Big Ballers', 'Synthetic: practice moved')::text$q$);
  perform sc.ok(v like 'OK:%', 'coach opens a channel for their programme');
  v_ch := substr(v, 4)::uuid;
  insert into sc.ids values ('channel', v_ch);
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2',
       $q$select public.msg_start_channel('program', '00000000-0000-0000-0000-000000000043', 'X', 'Synthetic')::text$q$);
  perform sc.ok(v like 'ERR:%NOT_ALLOWED%', 'a coach cannot open a channel for a programme they do not coach');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.msg_start_channel('program', '00000000-0000-0000-0000-000000000041', 'X', 'Synthetic')::text$q$);
  perform sc.ok(v like 'ERR:%NOT_ALLOWED%', 'a parent cannot open a channel');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000d2', format($q$select count(*)::text from public.msg_messages where conversation_id = %L$q$, v_ch));
  perform sc.ok(v = 'OK:1', 'guardians of the programme read the channel');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select count(*)::text from public.msg_messages where conversation_id = %L$q$, v_ch));
  perform sc.ok(v = 'OK:0', 'guardians outside the programme cannot read the channel');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2', format($q$select count(*)::text from public.msg_messages where conversation_id = %L$q$, v_ch));
  perform sc.ok(v = 'OK:0', 'coaches outside the programme cannot read the channel');
  v := sc.exec_as('a0000000-0000-0000-0000-0000000000d2',
       format($q$insert into public.msg_messages (org_id, conversation_id, sender_id, body) values ('00000000-0000-0000-0000-000000000001', %L, 'a0000000-0000-0000-0000-0000000000d2', 'Synthetic thanks')$q$, v_ch));
  perform sc.ok(v = 'OK:1', 'guardians reply in the channel when replies are allowed');
  perform sc.ok(not exists (select 1 from public.msg_participants where conversation_id = v_ch), 'channel replies do not create direct memberships');
  update public.messaging_settings set parent_replies_in_channels = false where org_id = '00000000-0000-0000-0000-000000000001';
  v := sc.exec_as('a0000000-0000-0000-0000-0000000000d2',
       format($q$insert into public.msg_messages (org_id, conversation_id, sender_id, body) values ('00000000-0000-0000-0000-000000000001', %L, 'a0000000-0000-0000-0000-0000000000d2', 'Synthetic again')$q$, v_ch));
  perform sc.ok(v like 'ERR:%', 'guardians cannot reply when the club turned channel replies off');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f3',
       format($q$insert into public.msg_messages (org_id, conversation_id, sender_id, body) values ('00000000-0000-0000-0000-000000000001', %L, '00000000-0000-0000-0000-0000000000f3', 'Synthetic staff post')$q$, v_ch));
  perform sc.ok(v = 'OK:1', 'staff still post in the channel');
  update public.messaging_settings set parent_replies_in_channels = true where org_id = '00000000-0000-0000-0000-000000000001';
end $$;

-- ===========================================================================
-- G. Moderation
-- ===========================================================================
do $$
declare v text; v_cf uuid := (select val from sc.ids where k = 'coach_family'); v_msg uuid;
begin
  select id into v_msg from public.msg_messages where conversation_id = v_cf and sender_id = 'a0000000-0000-0000-0000-0000000000d2' order by created_at limit 1;
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$insert into public.msg_reports (org_id, conversation_id, message_id, reporter_id, reason) values ('00000000-0000-0000-0000-000000000001', %L, %L, '00000000-0000-0000-0000-0000000000f4', 'Synthetic report') returning 'x'$q$, v_cf, v_msg));
  perform sc.ok(v like 'ERR:%', 'a parent cannot report a message they cannot read');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f3',
       format($q$insert into public.msg_reports (org_id, conversation_id, message_id, reporter_id, reason) values ('00000000-0000-0000-0000-000000000001', %L, %L, '00000000-0000-0000-0000-0000000000f3', 'Synthetic abuse report')$q$, v_cf, v_msg));
  perform sc.ok(v = 'OK:1', 'a participant reports a message');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000d2', $q$select count(*)::text from public.msg_reports$q$);
  perform sc.ok(v = 'OK:0', 'the reported sender cannot see the report');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.msg_reports where status = 'open'$q$);
  perform sc.ok(v = 'OK:1', 'admin sees the open report');

  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', format($q$select public.msg_hide_message(%L, true, 'x')::text$q$, v_msg));
  perform sc.ok(v like 'ERR:%NOT_ALLOWED%', 'a coach cannot hide messages');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select public.msg_hide_message(%L, true, 'Synthetic moderation')::text$q$, v_msg));
  perform sc.ok(v = 'OK:' || v_cf::text, 'admin hides a message');
  perform sc.ok((select status from public.msg_reports where message_id = v_msg) = 'resolved', 'hiding resolves the report');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', format($q$select count(*)::text from public.msg_messages where id = %L$q$, v_msg));
  perform sc.ok(v = 'OK:0', 'hidden message disappears for the other party');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000d2', format($q$select count(*)::text from public.msg_messages where id = %L$q$, v_msg));
  perform sc.ok(v = 'OK:1', 'the sender still sees their hidden message');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select count(*)::text from public.msg_messages where id = %L$q$, v_msg));
  perform sc.ok(v = 'OK:1', 'admin still sees the hidden message');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f1', format($q$delete from public.msg_messages where id = %L$q$, v_msg));
  perform sc.ok(v = 'OK:0', 'messages are never hard-deleted (not even by admins)');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f1', format($q$update public.msg_messages set body = 'Synthetic rewrite' where id = %L$q$, v_msg));
  perform sc.ok(v like 'ERR:%MESSAGE_IMMUTABLE%', 'message text cannot be rewritten');
  perform sc.ok(not exists (select 1 from public.audit_logs where target_table = 'msg_messages' and (new_data->>'body') not in ('[redacted]')),
                'message bodies never reach audit_logs');

  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', format($q$select public.msg_set_status(%L, 'closed')::text$q$, v_cf));
  perform sc.ok(v like 'ERR:%NOT_ALLOWED%', 'a coach cannot close a direct thread');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select public.msg_set_status(%L, 'closed')::text$q$, v_cf));
  perform sc.ok(v like 'OK:%', 'admin closes the thread');
  v := sc.exec_as('a0000000-0000-0000-0000-0000000000d2',
       format($q$insert into public.msg_messages (org_id, conversation_id, sender_id, body) values ('00000000-0000-0000-0000-000000000001', %L, 'a0000000-0000-0000-0000-0000000000d2', 'Synthetic late')$q$, v_cf));
  perform sc.ok(v like 'ERR:%', 'nobody posts in a closed thread');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select public.msg_set_status(%L, 'open')::text$q$, v_cf));
  perform sc.ok(v like 'OK:%', 'admin reopens the thread');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', format($q$select public.msg_set_status(%L, 'closed')::text$q$, (select val from sc.ids where k = 'channel')));
  perform sc.ok(v like 'OK:%', 'the channel''s coach can close their channel');
  update public.msg_conversations set status = 'open', closed_at = null, closed_by = null where id = (select val from sc.ids where k = 'channel');
end $$;

-- ===========================================================================
-- H. Unread counts and read state
-- ===========================================================================
do $$
declare v text; v_cf uuid := (select val from sc.ids where k = 'coach_family');
begin
  v := sc.run_as('a0000000-0000-0000-0000-0000000000d2', format($q$select unread::text from public.msg_inbox() where conversation_id = %L$q$, v_cf));
  perform sc.ok(v = 'OK:1', 'parent has one unread reply from the coach (' || v || ')');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000d2', format($q$select public.msg_mark_read(%L)::text$q$, v_cf));
  perform sc.ok(v like 'OK:%', 'parent marks the thread read');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000d2', format($q$select unread::text from public.msg_inbox() where conversation_id = %L$q$, v_cf));
  perform sc.ok(v = 'OK:0', 'unread count back to zero');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.msg_mark_read(%L)::text$q$, v_cf));
  perform sc.ok(v like 'ERR:%NOT_FOUND%', 'cannot mark another family''s thread read');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f4',
       format($q$insert into public.msg_read_state (org_id, conversation_id, profile_id) values ('00000000-0000-0000-0000-000000000001', %L, '00000000-0000-0000-0000-0000000000f4')$q$, v_cf));
  perform sc.ok(v like 'ERR:%', 'no read state for a thread the caller cannot read');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.msg_read_state where profile_id <> '00000000-0000-0000-0000-0000000000f3'$q$);
  perform sc.ok(v = 'OK:0', 'read state rows of others are private');
  -- read receipts only when the club turns them on
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', format($q$select count(last_read_at)::text from public.msg_people(%L)$q$, v_cf));
  perform sc.ok(v = 'OK:0', 'no read receipts by default');
  update public.messaging_settings set read_receipts = true where org_id = '00000000-0000-0000-0000-000000000001';
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', format($q$select count(last_read_at)::text from public.msg_people(%L)$q$, v_cf));
  perform sc.ok(v = 'OK:2', 'read receipts visible when turned on');
  update public.messaging_settings set read_receipts = false where org_id = '00000000-0000-0000-0000-000000000001';
end $$;

-- ===========================================================================
-- I. Alerts
-- ===========================================================================
do $$
declare v text;
begin
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.club_alerts (org_id, title, severity, audience, created_by) values ('00000000-0000-0000-0000-000000000001', 'Synthetic: gym closed', 'warning', 'parents', '00000000-0000-0000-0000-0000000000f1') returning id::text$q$);
  perform sc.ok(v like 'OK:%', 'admin creates a parents alert');
  insert into sc.ids values ('alert_parents', substr(v, 4)::uuid);
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.club_alerts (org_id, title, audience, starts_at, created_by) values ('00000000-0000-0000-0000-000000000001', 'Synthetic: later', 'all', now() + interval '2 days', '00000000-0000-0000-0000-0000000000f1') returning id::text$q$);
  perform sc.ok(v like 'OK:%', 'admin schedules an alert');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select string_agg(title, ',') from public.club_alerts$q$);
  perform sc.ok(v = 'OK:Synthetic: gym closed', 'parent sees the started parents alert, not the scheduled one (' || v || ')');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.club_alerts$q$);
  perform sc.ok(v = 'OK:0', 'staff do not see a parents-only alert');

  v := sc.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.club_alerts (org_id, title, audience, program_id, created_by) values ('00000000-0000-0000-0000-000000000001', 'Synthetic: bring water', 'program', '00000000-0000-0000-0000-000000000043', '00000000-0000-0000-0000-0000000000f3') returning id::text$q$);
  perform sc.ok(v like 'OK:%', 'coach sends an alert to their programme');
  insert into sc.ids values ('alert_program', substr(v, 4)::uuid);
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.club_alerts (org_id, title, audience, program_id, created_by) values ('00000000-0000-0000-0000-000000000001', 'Synthetic', 'program', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-0000000000f3')$q$);
  perform sc.ok(v like 'ERR:%', 'coach cannot alert a programme they do not coach');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.club_alerts (org_id, title, audience, created_by) values ('00000000-0000-0000-0000-000000000001', 'Synthetic', 'all', '00000000-0000-0000-0000-0000000000f3')$q$);
  perform sc.ok(v like 'ERR:%', 'coach cannot alert the whole club');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.club_alerts (org_id, title, audience, created_by) values ('00000000-0000-0000-0000-000000000001', 'Synthetic', 'parents', '00000000-0000-0000-0000-0000000000f4')$q$);
  perform sc.ok(v like 'ERR:%', 'parents cannot create alerts');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000d2', $q$select count(*)::text from public.club_alerts where audience = 'program'$q$);
  perform sc.ok(v = 'OK:1', 'guardians of the programme see the coach alert');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.club_alerts where audience = 'program'$q$);
  perform sc.ok(v = 'OK:0', 'other guardians do not see it');
  v := sc.exec_as('a0000000-0000-0000-0000-0000000000c2', format($q$update public.club_alerts set title = 'Synthetic hijack' where id = %L$q$, (select val from sc.ids where k = 'alert_program')));
  perform sc.ok(v = 'OK:0', 'another coach cannot edit the alert');

  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select count(*)::text from public.club_alert_recipients(%L)$q$, (select val from sc.ids where k = 'alert_program')));
  perform sc.ok(v like 'ERR:%', 'alert recipients are server-only');
  perform sc.ok((select count(*) from public.club_alert_recipients((select val from sc.ids where k = 'alert_program'))
                  where profile_id in ('a0000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f3')) = 2,
                'programme alert reaches the programme''s guardians and coach');
  perform sc.ok(not exists (select 1 from public.club_alert_recipients((select val from sc.ids where k = 'alert_program'))
                             where profile_id = '00000000-0000-0000-0000-0000000000f4'), 'programme alert skips other families');
  perform sc.ok(not exists (select 1 from public.club_alert_recipients((select val from sc.ids where k = 'alert_parents'))
                             where profile_id = 'b0000000-0000-0000-0000-0000000000d1'), 'recipients never cross clubs');

  v := sc.exec_as('00000000-0000-0000-0000-0000000000f4',
       format($q$insert into public.club_alert_dismissals (org_id, alert_id, profile_id) values ('00000000-0000-0000-0000-000000000001', %L, '00000000-0000-0000-0000-0000000000f4')$q$, (select val from sc.ids where k = 'alert_parents')));
  perform sc.ok(v = 'OK:1', 'parent dismisses the banner');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f4',
       format($q$insert into public.club_alert_dismissals (org_id, alert_id, profile_id) values ('00000000-0000-0000-0000-000000000001', %L, 'a0000000-0000-0000-0000-0000000000d2')$q$, (select val from sc.ids where k = 'alert_parents')));
  perform sc.ok(v like 'ERR:%', 'cannot dismiss for someone else');
end $$;

-- ===========================================================================
-- J. Notification preferences
-- ===========================================================================
do $$
declare v text;
begin
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.notification_preferences (org_id, profile_id, channels) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f4', '{"messages":{"email":false}}')$q$);
  perform sc.ok(v = 'OK:1', 'user saves their own preferences');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.notification_preferences (org_id, profile_id) values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d2')$q$);
  perform sc.ok(v like 'ERR:%', 'cannot write someone else''s preferences');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.notification_preferences$q$);
  perform sc.ok(v = 'OK:0', 'preferences are private (even from admins)');
end $$;

-- ===========================================================================
-- K. Leads
-- ===========================================================================
do $$
declare v text; i int;
begin
  v := sc.exec_as(null, $q$insert into public.contact_leads (org_id, name, email, message, consent_contact) values ('00000000-0000-0000-0000-000000000001', 'X', 'x@example.test', 'Synthetic', true)$q$);
  perform sc.ok(v like 'ERR:%', 'anonymous cannot insert leads directly');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f4', $q$insert into public.contact_leads (org_id, name, email, message, consent_contact) values ('00000000-0000-0000-0000-000000000001', 'X', 'x@example.test', 'Synthetic', true)$q$);
  perform sc.ok(v like 'ERR:%', 'signed-in users cannot insert leads directly');
  v := sc.run_as(null, $q$select public.contact_lead_submit('00000000-0000-0000-0000-000000000001', 'X', 'x@example.test', null, 'Synthetic', 'camp', true)::text$q$);
  perform sc.ok(v like 'ERR:%', 'anonymous cannot call the submit function');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.contact_lead_submit('00000000-0000-0000-0000-000000000001', 'X', 'x@example.test', null, 'Synthetic', 'camp', true)::text$q$);
  perform sc.ok(v like 'ERR:%', 'signed-in users cannot call the submit function');

  -- server code (no user session)
  begin
    perform public.contact_lead_submit('00000000-0000-0000-0000-000000000001', 'Synthetic Lead', 'lead@example.test', null, 'Synthetic question', 'camp', false);
    perform sc.ok(false, 'consent is required');
  exception when others then perform sc.ok(sqlerrm like '%CONSENT_REQUIRED%', 'consent is required');
  end;
  for i in 1..3 loop
    perform public.contact_lead_submit('00000000-0000-0000-0000-000000000001', 'Synthetic Lead ' || i, 'lead' || i || '@example.test', null,
                                       'Synthetic question', 'training', true, '/club', 'fr', 'hash-1');
  end loop;
  perform sc.ok((select count(*) from public.contact_leads where ip_hash = 'hash-1') = 3, 'server code stores leads');
  begin
    perform public.contact_lead_submit('00000000-0000-0000-0000-000000000001', 'Synthetic Lead 4', 'lead4@example.test', null, 'Synthetic', 'other', true, null, null, 'hash-1');
    perform sc.ok(false, 'fourth submission from the same IP hash within 10 minutes is rate limited');
  exception when others then perform sc.ok(sqlerrm like '%RATE_LIMITED%', 'fourth submission from the same IP hash within 10 minutes is rate limited');
  end;
  perform public.contact_lead_submit('00000000-0000-0000-0000-000000000001', 'Synthetic Lead 5', 'lead5@example.test', null, 'Synthetic', 'team', true, null, null, 'hash-2');
  perform sc.ok((select count(*) from public.contact_leads where org_id = '00000000-0000-0000-0000-000000000001') = 4, 'another IP hash is not limited');
  perform public.contact_lead_submit('10000000-0000-0000-0000-000000000002', 'Synthetic Lead B', 'leadb@example.test', null, 'Synthetic', 'team', true, null, null, 'hash-1');
  perform sc.ok((select count(*) from public.contact_leads where org_id = '10000000-0000-0000-0000-000000000002') = 1, 'rate limit is per club');
  perform sc.ok(not exists (select 1 from public.audit_logs where target_table = 'contact_leads' and new_data->>'email' <> '[redacted]'),
                'lead contact details are redacted from audit_logs');

  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.contact_leads$q$);
  perform sc.ok(v = 'OK:4', 'admin sees the club''s leads only');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.contact_leads$q$);
  perform sc.ok(v = 'OK:0', 'coaches do not see leads');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.contact_leads$q$);
  perform sc.ok(v = 'OK:0', 'finance does not see leads');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f1', $q$update public.contact_leads set status = 'replied' where email = 'lead1@example.test'$q$);
  perform sc.ok(v = 'OK:1', 'admin updates a lead status');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f1',
       format($q$insert into public.contact_lead_replies (org_id, lead_id, author_id, body) values ('00000000-0000-0000-0000-000000000001', %L, '00000000-0000-0000-0000-0000000000f1', 'Synthetic reply')$q$,
              (select id from public.contact_leads where email = 'lead1@example.test')));
  perform sc.ok(v = 'OK:1', 'admin records a reply');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f1', $q$update public.contact_leads set status = 'bogus'$q$);
  perform sc.ok(v like 'ERR:%', 'invalid lead status refused');
end $$;

-- ===========================================================================
-- L. Attachments bucket
-- ===========================================================================
do $$
declare v text; v_cf uuid := (select val from sc.ids where k = 'coach_family'); v_path text; v_msg uuid;
begin
  v_path := '00000000-0000-0000-0000-000000000001/' || v_cf || '/synthetic.pdf';
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f4', format($q$insert into storage.objects (bucket_id, name) values ('message-attachments', %L)$q$, v_path));
  perform sc.ok(v like 'ERR:%', 'a parent cannot upload into another family''s thread');
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f3', format($q$insert into storage.objects (bucket_id, name) values ('message-attachments', %L)$q$, v_path));
  perform sc.ok(v = 'OK:1', 'a participant uploads a file into the thread');
  select id into v_msg from public.msg_messages where conversation_id = v_cf and sender_id = '00000000-0000-0000-0000-0000000000f3' order by created_at desc limit 1;
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f3',
       format($q$insert into public.msg_attachments (org_id, conversation_id, message_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) values ('00000000-0000-0000-0000-000000000001', %L, %L, %L, 'synthetic.pdf', 'application/pdf', 1000, '00000000-0000-0000-0000-0000000000f3')$q$,
              v_cf, v_msg, v_path));
  perform sc.ok(v = 'OK:1', 'the sender records the attachment');
  v := sc.exec_as('a0000000-0000-0000-0000-0000000000d2',
       format($q$insert into public.msg_attachments (org_id, conversation_id, message_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) values ('00000000-0000-0000-0000-000000000001', %L, %L, %L, 'x.pdf', 'application/pdf', 1000, 'a0000000-0000-0000-0000-0000000000d2')$q$,
              v_cf, v_msg, v_path || 'x'));
  perform sc.ok(v like 'ERR:%', 'cannot attach a file to someone else''s message');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000d2', format($q$select count(*)::text from storage.objects where name = %L$q$, v_path));
  perform sc.ok(v = 'OK:1', 'the other participant can read the file');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select count(*)::text from storage.objects where name = %L$q$, v_path));
  perform sc.ok(v = 'OK:0', 'another parent cannot read the file');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2', format($q$select count(*)::text from storage.objects where name = %L$q$, v_path));
  perform sc.ok(v = 'OK:0', 'a coach outside the thread cannot read the file');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1', format($q$select count(*)::text from storage.objects where name = %L$q$, v_path));
  perform sc.ok(v = 'OK:0', 'another club''s admin cannot read the file');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000d2', format($q$select count(*)::text from public.msg_attachments where conversation_id = %L$q$, v_cf));
  perform sc.ok(v = 'OK:1', 'participant lists the attachment');
  update public.msg_messages set hidden_at = now() where id = v_msg;
  v := sc.run_as('a0000000-0000-0000-0000-0000000000d2', format($q$select count(*)::text from storage.objects where name = %L$q$, v_path));
  perform sc.ok(v = 'OK:0', 'files of hidden messages are no longer readable');
  update public.msg_messages set hidden_at = null where id = v_msg;
  v := sc.exec_as('00000000-0000-0000-0000-0000000000f3', format($q$delete from storage.objects where name = %L$q$, v_path));
  perform sc.ok(v = 'OK:0', 'participants cannot delete stored files');
  v := sc.exec_as('b0000000-0000-0000-0000-0000000000c1', format($q$delete from storage.objects where name = %L$q$, v_path));
  perform sc.ok(v = 'OK:0', 'another club''s admin cannot delete the file');
end $$;

-- ===========================================================================
-- M. Cross-tenant denial + same-org guards
-- ===========================================================================
do $$
declare v text; t text; v_cf uuid := (select val from sc.ids where k = 'coach_family');
begin
  insert into public.messaging_settings (org_id) values ('10000000-0000-0000-0000-000000000002');
  foreach t in array array['messaging_settings', 'msg_conversations', 'msg_participants', 'msg_messages', 'msg_attachments',
                           'msg_read_state', 'msg_reports', 'notification_preferences', 'club_alerts', 'club_alert_dismissals',
                           'contact_leads', 'contact_lead_replies'] loop
    v := sc.run_as('b0000000-0000-0000-0000-0000000000c1', format('select count(*)::text from public.%I where org_id = %L', t, '00000000-0000-0000-0000-000000000001'));
    perform sc.ok(v = 'OK:0', 'org B admin sees no org A rows in ' || t || ' (' || v || ')');
    v := sc.run_as('b0000000-0000-0000-0000-0000000000d1', format('select count(*)::text from public.%I where org_id = %L', t, '00000000-0000-0000-0000-000000000001'));
    perform sc.ok(v = 'OK:0', 'org B guardian sees no org A rows in ' || t);
  end loop;
  v := sc.exec_as('b0000000-0000-0000-0000-0000000000c1',
       format($q$insert into public.msg_messages (org_id, conversation_id, sender_id, body) values ('00000000-0000-0000-0000-000000000001', %L, 'b0000000-0000-0000-0000-0000000000c1', 'Synthetic')$q$, v_cf));
  perform sc.ok(v like 'ERR:%', 'org B admin cannot post into an org A thread');
  v := sc.exec_as('b0000000-0000-0000-0000-0000000000c1',
       format($q$insert into public.msg_messages (org_id, conversation_id, sender_id, body) values ('10000000-0000-0000-0000-000000000002', %L, 'b0000000-0000-0000-0000-0000000000c1', 'Synthetic')$q$, v_cf));
  perform sc.ok(v like 'ERR:%', 'org B admin cannot post into an org A thread under their own org id');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1', format($q$select public.msg_hide_message(id, true, null)::text from public.msg_messages where conversation_id = %L limit 1$q$, v_cf));
  perform sc.ok(v in ('OK:<null>'), 'org B admin cannot reach org A messages to hide');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1', format($q$select public.msg_set_status(%L, 'closed')::text$q$, v_cf));
  perform sc.ok(v like 'ERR:%NOT_FOUND%', 'org B admin cannot close an org A thread');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1', format($q$select public.msg_mark_read(%L)::text$q$, v_cf));
  perform sc.ok(v like 'ERR:%NOT_FOUND%', 'org B admin cannot mark an org A thread read');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1', format($q$select count(*)::text from public.msg_people(%L)$q$, v_cf));
  perform sc.ok(v = 'OK:0', 'org B admin cannot list org A thread people');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1', $q$select count(*)::text from public.msg_inbox(true)$q$);
  perform sc.ok(v = 'OK:0', 'org B admin inbox has no org A threads');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1', $q$select count(*)::text from public.msg_contacts() where profile_id in ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f3')$q$);
  perform sc.ok(v = 'OK:0', 'org B admin contacts never list org A people');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$select public.msg_start_channel('program', '00000000-0000-0000-0000-000000000043', 'X', 'Synthetic')::text$q$);
  perform sc.ok(v like 'ERR:%SCOPE_NOT_FOUND%', 'org B admin cannot open a channel on an org A programme');
  v := sc.exec_as('b0000000-0000-0000-0000-0000000000c1',
       $q$insert into public.club_alerts (org_id, title, audience, created_by) values ('00000000-0000-0000-0000-000000000001', 'Synthetic', 'all', 'b0000000-0000-0000-0000-0000000000c1')$q$);
  perform sc.ok(v like 'ERR:%', 'org B admin cannot create org A alerts');
  v := sc.exec_as('b0000000-0000-0000-0000-0000000000c1',
       $q$insert into public.club_alerts (org_id, title, audience, program_id, created_by) values ('10000000-0000-0000-0000-000000000002', 'Synthetic', 'program', '00000000-0000-0000-0000-000000000043', 'b0000000-0000-0000-0000-0000000000c1')$q$);
  perform sc.ok(v like 'ERR:%CROSS_ORG_REFERENCE%', 'alerts cannot target another club''s programme');
  v := sc.exec_as('b0000000-0000-0000-0000-0000000000c1', $q$update public.contact_leads set status = 'closed' where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform sc.ok(v = 'OK:0', 'org B admin cannot touch org A leads');
  v := sc.exec_as('b0000000-0000-0000-0000-0000000000c1', $q$update public.messaging_settings set read_receipts = true where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform sc.ok(v = 'OK:0', 'org B admin cannot change org A messaging settings');

  -- same-org guards (even for server code)
  begin
    insert into public.msg_conversations (org_id, kind, family_id) values ('10000000-0000-0000-0000-000000000002', 'direct', '00000000-0000-0000-0000-000000000061');
    perform sc.ok(false, 'conversation cannot reference another club''s family');
  exception when others then perform sc.ok(sqlerrm like '%CROSS_ORG_REFERENCE%', 'conversation cannot reference another club''s family');
  end;
  begin
    insert into public.msg_participants (org_id, conversation_id, profile_id, side) values ('00000000-0000-0000-0000-000000000001', v_cf, 'b0000000-0000-0000-0000-0000000000c1', 'staff');
    perform sc.ok(false, 'participant cannot come from another club');
  exception when others then perform sc.ok(sqlerrm ~ '(CROSS_ORG_REFERENCE|NOT_A_STAFF_MEMBER)', 'participant cannot come from another club');
  end;
  begin
    insert into public.msg_participants (org_id, conversation_id, profile_id, side) values ('00000000-0000-0000-0000-000000000001', v_cf, 'a0000000-0000-0000-0000-0000000000e9', 'family');
    perform sc.ok(false, 'only staff or guardians can be participants (no athlete / outsider identities)');
  exception when others then perform sc.ok(sqlerrm like '%NOT_A_GUARDIAN%', 'only staff or guardians can be participants (no athlete / outsider identities)');
  end;
  begin
    insert into public.msg_participants (org_id, conversation_id, profile_id, side) values ('00000000-0000-0000-0000-000000000001', v_cf, '00000000-0000-0000-0000-0000000000f4', 'staff');
    perform sc.ok(false, 'a guardian cannot join as staff');
  exception when others then perform sc.ok(sqlerrm like '%NOT_A_STAFF_MEMBER%', 'a guardian cannot join as staff');
  end;
  perform sc.ok(not has_function_privilege('anon', 'public.msg_inbox(boolean, integer)', 'execute'), 'anon cannot execute msg_inbox');
  perform sc.ok(not has_function_privilege('authenticated', 'public.msg_conversation_audience(uuid)', 'execute'), 'thread audience is server-only');
  perform sc.ok(not has_function_privilege('authenticated', 'public.contact_lead_submit(uuid, text, text, text, text, text, boolean, text, text, text, uuid)', 'execute'),
                'lead submission is server-only');
  perform sc.ok((select count(*) from pg_policies where schemaname = 'public' and tablename in (
                  'messaging_settings', 'msg_conversations', 'msg_participants', 'msg_messages', 'msg_attachments',
                  'msg_read_state', 'msg_reports', 'notification_preferences', 'club_alerts', 'club_alert_dismissals',
                  'contact_leads', 'contact_lead_replies')) = 48, 'every new table has a policy for each of the four verbs');
  perform sc.ok((select bool_and(relrowsecurity) from pg_class where relnamespace = 'public'::regnamespace and relname in (
                  'messaging_settings', 'msg_conversations', 'msg_participants', 'msg_messages', 'msg_attachments',
                  'msg_read_state', 'msg_reports', 'notification_preferences', 'club_alerts', 'club_alert_dismissals',
                  'contact_leads', 'contact_lead_replies')), 'RLS enabled on every new table');
end $$;
