-- ============================================================================
-- DLang Basketball — Auth flow test suite (run against the live schema).
-- Any failed assertion RAISEs and aborts (psql ON_ERROR_STOP). A clean run = pass.
-- Covers: admin invite -> Supabase creates user -> trigger auto-links ->
--         parent/coach RLS isolation -> onboarding self-update -> negatives.
-- ============================================================================
\set ON_ERROR_STOP on

-- Fixed UUIDs for this run
-- org=...001  Lopes fam=...061  Müller fam=...062  coach Marc=...017  admin=...f1
--   invites: de01 (parent->Müller), de02 (coach->Marc), decoy
--   users:   ad01 (Hans, parent)   ad02 (Marc, coach)

-- ---------------------------------------------------------------------------
-- ARRANGE: admin creates invitations
-- ---------------------------------------------------------------------------
insert into invitations (id, org_id, email, role, family_id, relation, invited_by) values
  ('00000000-0000-0000-0000-00000000de01','00000000-0000-0000-0000-000000000001','hans.muller@example.com','parent','00000000-0000-0000-0000-000000000062','father','00000000-0000-0000-0000-0000000000f1');
insert into invitations (id, org_id, email, role, coach_id, invited_by) values
  ('00000000-0000-0000-0000-00000000de02','00000000-0000-0000-0000-000000000001','marc@dlang.test','coach','00000000-0000-0000-0000-000000000017','00000000-0000-0000-0000-0000000000f1');
-- decoy invite for an unrelated person (used to test invitee isolation)
insert into invitations (org_id, email, role, family_id) values
  ('00000000-0000-0000-0000-000000000001','someone.else@example.com','parent','00000000-0000-0000-0000-000000000061');

-- ---------------------------------------------------------------------------
-- ACT: Supabase creates the auth users (mimics inviteUserByEmail acceptance).
--      The handle_new_user trigger fires synchronously.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, confirmation_token, recovery_token,
   email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-00000000ad01','authenticated','authenticated','hans.muller@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '','','','','{"provider":"email","providers":["email"]}','{"full_name":"Hans Müller"}'),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-00000000ad02','authenticated','authenticated','marc@dlang.test', crypt('password123', gen_salt('bf')), now(), now(), now(), '','','','','{"provider":"email","providers":["email"]}','{"full_name":"Marc Coach"}');

-- ---------------------------------------------------------------------------
-- ASSERT 1: trigger consumed the invitations correctly (structural)
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from profiles where id='00000000-0000-0000-0000-00000000ad01' and org_id='00000000-0000-0000-0000-000000000001' and onboarding_completed_at is null)
    then raise exception 'FAIL: Hans profile missing / wrong org / wrongly onboarded'; end if;
  if not exists (select 1 from family_members where profile_id='00000000-0000-0000-0000-00000000ad01' and family_id='00000000-0000-0000-0000-000000000062' and is_primary)
    then raise exception 'FAIL: Hans not linked as primary guardian of Müller'; end if;
  if not exists (select 1 from invitations where id='00000000-0000-0000-0000-00000000de01' and status='accepted' and accepted_by='00000000-0000-0000-0000-00000000ad01')
    then raise exception 'FAIL: parent invitation not marked accepted'; end if;
  if exists (select 1 from staff_roles where profile_id='00000000-0000-0000-0000-00000000ad01')
    then raise exception 'FAIL: parent must NOT get a staff_roles row'; end if;

  if not exists (select 1 from staff_roles where profile_id='00000000-0000-0000-0000-00000000ad02' and role='coach')
    then raise exception 'FAIL: Marc missing coach staff role'; end if;
  if not exists (select 1 from coaches where id='00000000-0000-0000-0000-000000000017' and profile_id='00000000-0000-0000-0000-00000000ad02')
    then raise exception 'FAIL: Marc coach record not linked to login'; end if;
  if not exists (select 1 from invitations where id='00000000-0000-0000-0000-00000000de02' and status='accepted')
    then raise exception 'FAIL: coach invitation not accepted'; end if;
  raise notice 'PASS 1 — invite consumption (parent linked, coach linked, invites accepted)';
end $$;

-- ---------------------------------------------------------------------------
-- ASSERT 2: invited parent Hans is fully isolated to the Müller family
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ad01';
  do $$ declare c int; begin
    select count(*) into c from athletes;
    if c <> 2 then raise exception 'FAIL: Hans should see 2 athletes (Lucas, Sophia), saw %', c; end if;
    if exists (select 1 from athletes where first_name='Mateo') then raise exception 'FAIL: Hans must not see Mateo (Lopes)'; end if;
    select count(*) into c from invoices;
    if c <> 1 then raise exception 'FAIL: Hans should see only the Müller invoice, saw %', c; end if;
    select count(*) into c from athlete_medical;
    if c <> 1 then raise exception 'FAIL: Hans should see only Lucas medical, saw %', c; end if;
    if not exists (select 1 from invitations where email='hans.muller@example.com') then raise exception 'FAIL: Hans cannot read own invitation'; end if;
    if exists (select 1 from invitations where email='someone.else@example.com') then raise exception 'FAIL: Hans can read someone else''s invitation'; end if;
    raise notice 'PASS 2 — parent isolation (own family + own invite only)';
  end $$;
rollback;

-- ---------------------------------------------------------------------------
-- ASSERT 3: invited coach Marc can access his assigned athlete (Mateo, SPSA W1)
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ad02';
  do $$ begin
    if not exists (select 1 from athletes where first_name='Mateo')
      then raise exception 'FAIL: coach Marc should see Mateo via the SPSA W1 program he coaches'; end if;
    raise notice 'PASS 3 — coach access to assigned athlete';
  end $$;
rollback;

-- ---------------------------------------------------------------------------
-- ASSERT 4: Hans completes onboarding (self-update allowed by RLS)
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ad01';
  update profiles set onboarding_completed_at = now() where id = '00000000-0000-0000-0000-00000000ad01';
  do $$ begin
    if not exists (select 1 from profiles where id='00000000-0000-0000-0000-00000000ad01' and onboarding_completed_at is not null)
      then raise exception 'FAIL: onboarding self-update was blocked'; end if;
    raise notice 'PASS 4 — onboarding completion (profile self-update)';
  end $$;
rollback;

-- ---------------------------------------------------------------------------
-- ASSERT 5: a parent cannot create invitations (admin-only)
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ad01';
  do $$ declare denied boolean := false; begin
    begin
      insert into invitations (org_id, email, role, family_id)
      values ('00000000-0000-0000-0000-000000000001','sneaky@example.com','parent','00000000-0000-0000-0000-000000000062');
    exception when others then denied := true; end;
    if not denied then raise exception 'FAIL: parent was able to create an invitation'; end if;
    raise notice 'PASS 5 — parent cannot create invitations (RLS denied)';
  end $$;
rollback;

-- cleanup the test rows so the suite is re-runnable
delete from auth.users where id in ('00000000-0000-0000-0000-00000000ad01','00000000-0000-0000-0000-00000000ad02');
delete from invitations where email in ('hans.muller@example.com','marc@dlang.test','someone.else@example.com');
update coaches set profile_id = null where id='00000000-0000-0000-0000-000000000017';
