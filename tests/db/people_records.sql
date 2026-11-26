-- ============================================================================
-- People & records suite (migration 20250420095700_people_records_editing.sql)
--
--   A. athlete-photos bucket: private; admin + guardian read/write, coach read
--      only for accessible athletes, finance nothing; another org's admin can
--      neither read nor write; malformed keys are refused.
--   B. athletes.photo_path must sit under <org_id>/<athlete_id>/.
--   C. Cross-tenant edits: org B admin cannot change org A athletes, families,
--      registrations or documents; references to another org are refused.
--   D. family_members: admin links are org-scoped.
--   E. Consents: manual (paper) records are appended, immutable, and withdrawn
--      only through withdraw_consent_with_reason (reason required, own org).
--   F. Audit: athlete and family edits are written to audit_logs.
--   G. anonymise_family clears photos and returns their paths.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach Derrick
-- …f3 = coach …011 who leads program …043, guardian Carla …f4 of family …061
-- / athlete …071), athletes …072/…073 in program …043. Org B …0002 is
-- created by seed_tenants.sql; its admin and records are created here.
-- SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema pr;
grant usage on schema pr to authenticated, anon, service_role;

create function pr.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p (null = service_role). Returns 'OK:<first column>' or 'ERR:<message>'.
create function pr.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
grant execute on all functions in schema pr to authenticated, anon, service_role;

-- Org B: admin, family, athlete, program, consent form (synthetic).
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000c1', 'admin-b@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id = 'b0000000-0000-0000-0000-0000000000c1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000c1', 'admin');
insert into public.families (id, org_id, name) values
  ('b0000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-000000000002', 'Synthetic B family');
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob) values
  ('b0000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-0000000000d1', 'Test', 'Bplayer', '2015-01-01');
insert into public.programs (id, org_id, slug, name, kind) values
  ('b0000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000002', 'pr-b-team', 'B team', 'recurring_team');
insert into public.consent_forms (id, org_id, key, title, body, version) values
  ('b0000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-000000000002', 'media', 'B media', 'Synthetic text', 1);

-- A document of org A (metadata edit tests).
insert into public.documents (id, org_id, athlete_id, kind, storage_path, file_name, title) values
  ('a0000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000072', 'other', '00000000-0000-0000-0000-000000000001/x-doc.pdf', 'x-doc.pdf', 'Old title');

-- ===========================================================================
-- A. Storage: athlete-photos
-- ===========================================================================
do $$
declare v text;
  k71 text := '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000071/p1.jpg';
  k72 text := '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000072/p1.jpg';
begin
  perform pr.ok((select public = false from storage.buckets where id = 'athlete-photos'), 'athlete-photos bucket exists and is private');

  -- Admin of org A writes and reads.
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$insert into storage.objects (bucket_id, name) values ('athlete-photos', %L) returning name$q$, k72));
  perform pr.ok(v like 'OK:%', 'org A admin uploads a photo for athlete 072 (' || v || ')');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select count(*)::text from storage.objects where bucket_id = 'athlete-photos'$q$);
  perform pr.ok(v = 'OK:1', 'org A admin reads the photo (' || v || ')');

  -- Guardian Carla: own child yes, another child no.
  v := pr.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$insert into storage.objects (bucket_id, name) values ('athlete-photos', %L) returning name$q$, k71));
  perform pr.ok(v like 'OK:%', 'guardian uploads a photo of her own child (' || v || ')');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$insert into storage.objects (bucket_id, name) values ('athlete-photos', %L) returning name$q$,
              '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000072/planted.jpg'));
  perform pr.ok(v like 'ERR:%', 'guardian cannot upload a photo of another family''s child');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select string_agg(name, ',') from storage.objects where bucket_id = 'athlete-photos'$q$);
  perform pr.ok(v = 'OK:' || k71, 'guardian sees only her own child''s photo (' || v || ')');

  -- Coach Derrick leads program 043 (athlete 072), not 041 (athlete 071).
  v := pr.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select string_agg(name, ',') from storage.objects where bucket_id = 'athlete-photos'$q$);
  perform pr.ok(v = 'OK:' || k72, 'coach reads only the photo of an athlete he coaches (' || v || ')');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f3',
       format($q$insert into storage.objects (bucket_id, name) values ('athlete-photos', %L) returning name$q$,
              '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000072/coach.jpg'));
  perform pr.ok(v like 'ERR:%', 'coach cannot upload athlete photos');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f3',
       format($q$with d as (delete from storage.objects where name = %L returning 1) select count(*)::text from d$q$, k72));
  perform pr.ok(v = 'OK:0', 'coach cannot delete athlete photos (' || v || ')');

  -- Finance: no access.
  v := pr.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$select count(*)::text from storage.objects where bucket_id = 'athlete-photos'$q$);
  perform pr.ok(v = 'OK:0', 'finance user cannot read athlete photos (' || v || ')');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f2',
       format($q$insert into storage.objects (bucket_id, name) values ('athlete-photos', %L) returning name$q$,
              '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000072/fin.jpg'));
  perform pr.ok(v like 'ERR:%', 'finance user cannot upload athlete photos');

  -- Anonymous: nothing.
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    execute 'set local role anon';
    v := (select count(*)::text from storage.objects where bucket_id = 'athlete-photos');
    execute 'reset role';
  exception when insufficient_privilege then
    execute 'reset role';
    v := 'denied';
  end;
  perform pr.ok(v in ('0', 'denied'), 'anonymous caller reads no athlete photo (' || v || ')');

  -- Org B admin: cross-tenant denial.
  v := pr.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$select count(*)::text from storage.objects where bucket_id = 'athlete-photos'$q$);
  perform pr.ok(v = 'OK:0', 'org B admin cannot read org A athlete photos (' || v || ')');
  v := pr.run_as('b0000000-0000-0000-0000-0000000000c1',
       format($q$insert into storage.objects (bucket_id, name) values ('athlete-photos', %L) returning name$q$,
              '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000072/b.jpg'));
  perform pr.ok(v like 'ERR:%', 'org B admin cannot upload into org A''s folder');
  v := pr.run_as('b0000000-0000-0000-0000-0000000000c1',
       format($q$insert into storage.objects (bucket_id, name) values ('athlete-photos', %L) returning name$q$,
              '10000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-000000000072/b.jpg'));
  perform pr.ok(v like 'ERR:%', 'org B admin cannot file a photo of an org A athlete under its own folder');
  v := pr.run_as('b0000000-0000-0000-0000-0000000000c1',
       format($q$with d as (delete from storage.objects where name = %L returning 1) select count(*)::text from d$q$, k72));
  perform pr.ok(v = 'OK:0', 'org B admin cannot delete an org A photo (' || v || ')');
  v := pr.run_as('b0000000-0000-0000-0000-0000000000c1',
       format($q$insert into storage.objects (bucket_id, name) values ('athlete-photos', %L) returning name$q$,
              '10000000-0000-0000-0000-000000000002/b0000000-0000-0000-0000-0000000000e1/own.jpg'));
  perform pr.ok(v like 'OK:%', 'org B admin uploads a photo of its own athlete (' || v || ')');

  -- Malformed keys.
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into storage.objects (bucket_id, name) values ('athlete-photos', '00000000-0000-0000-0000-000000000001/flat.jpg') returning name$q$);
  perform pr.ok(v like 'ERR:%', 'a key without the athlete folder is refused');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into storage.objects (bucket_id, name) values ('athlete-photos', '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000072/a/b.jpg') returning name$q$);
  perform pr.ok(v like 'ERR:%', 'a nested key is refused');

  perform pr.ok((select count(*) from storage.objects where name = k72) = 1, 'org A photo still present');
end $$;

-- ===========================================================================
-- B. photo_path scope
-- ===========================================================================
do $$
declare v text;
begin
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.athletes set photo_path = '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000072/p1.jpg', photo_updated_at = now()
           where id = '00000000-0000-0000-0000-000000000072' returning photo_path$q$);
  perform pr.ok(v like 'OK:00000000-%', 'admin stores the photo path on the athlete (' || left(v, 20) || ')');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.athletes set photo_path = '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000071/p1.jpg'
           where id = '00000000-0000-0000-0000-000000000072' returning photo_path$q$);
  perform pr.ok(v like 'ERR:%athletes_photo_path_scope%', 'a photo path of another athlete is refused');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$update public.athletes set photo_path = '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000071/p1.jpg'
           where id = '00000000-0000-0000-0000-000000000071' returning photo_path$q$);
  perform pr.ok(v like 'OK:00000000-%', 'guardian stores the photo path on her own child');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select coalesce(photo_path, '-') from public.athletes where id = '00000000-0000-0000-0000-000000000072'$q$);
  perform pr.ok(v like 'OK:00000000-%', 'coach reads the photo path of an athlete he coaches');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select count(*)::text from public.athletes where id = '00000000-0000-0000-0000-000000000071'$q$);
  perform pr.ok(v = 'OK:0', 'coach cannot read an athlete he does not coach (' || v || ')');
end $$;

-- ===========================================================================
-- C. Cross-tenant edits and references
-- ===========================================================================
do $$
declare v text;
begin
  v := pr.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$with u as (update public.athletes set first_name = 'Hacked' where id = '00000000-0000-0000-0000-000000000072' returning 1) select count(*)::text from u$q$);
  perform pr.ok(v = 'OK:0', 'org B admin cannot edit an org A athlete (' || v || ')');
  v := pr.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$with u as (update public.families set name = 'Hacked' where id = '00000000-0000-0000-0000-000000000061' returning 1) select count(*)::text from u$q$);
  perform pr.ok(v = 'OK:0', 'org B admin cannot edit an org A family (' || v || ')');
  v := pr.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$with u as (update public.registrations set status = 'cancelled', cancellation_reason = 'x' where id = '00000000-0000-0000-0000-000000000082' returning 1) select count(*)::text from u$q$);
  perform pr.ok(v = 'OK:0', 'org B admin cannot cancel an org A registration (' || v || ')');
  v := pr.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$with u as (update public.documents set title = 'Hacked', expires_at = current_date where id = 'a0000000-0000-0000-0000-0000000000d9' returning 1) select count(*)::text from u$q$);
  perform pr.ok(v = 'OK:0', 'org B admin cannot edit an org A document (' || v || ')');
  v := pr.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$select count(*)::text from public.athletes where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform pr.ok(v = 'OK:0', 'org B admin reads no org A athlete (' || v || ')');

  -- Org A admin: own edits work.
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.registrations set status = 'cancelled', cancellation_reason = 'Synthetic reason', cancelled_at = now(),
                     cancelled_by = '00000000-0000-0000-0000-0000000000f1'
                     where id = '00000000-0000-0000-0000-000000000082' returning 1) select count(*)::text from u$q$);
  perform pr.ok(v = 'OK:1', 'org A admin cancels a registration with a reason (' || v || ')');
  perform pr.ok(not exists (select 1 from public.audit_logs where target_table = 'registrations'
                              and new_data::text like '%Synthetic reason%'),
                'cancellation reason is redacted in audit_logs');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.registrations set program_id = '00000000-0000-0000-0000-000000000044'
                     where id = '00000000-0000-0000-0000-000000000082' returning 1) select count(*)::text from u$q$);
  perform pr.ok(v = 'OK:1', 'org A admin moves a registration to another of its programmes (' || v || ')');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.registrations set program_id = 'b0000000-0000-0000-0000-0000000000a1'
           where id = '00000000-0000-0000-0000-000000000082' returning id::text$q$);
  perform pr.ok(v like 'ERR:%CROSS_TENANT%' or v = 'OK:<null>', 'org A admin cannot move a registration to an org B programme (' || left(v, 60) || ')');
  perform pr.ok((select program_id from public.registrations where id = '00000000-0000-0000-0000-000000000082') = '00000000-0000-0000-0000-000000000044',
                'registration programme unchanged after the refused move');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.athletes set family_id = 'b0000000-0000-0000-0000-0000000000d1'
           where id = '00000000-0000-0000-0000-000000000072' returning id::text$q$);
  perform pr.ok(v like 'ERR:%CROSS_TENANT%', 'org A admin cannot move an athlete into an org B family');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.athletes set family_id = '00000000-0000-0000-0000-000000000061'
           where id = '00000000-0000-0000-0000-000000000073' returning family_id::text$q$);
  perform pr.ok(v = 'OK:00000000-0000-0000-0000-000000000061', 'org A admin moves an athlete to another of its families');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.documents set title = 'New title', expires_at = '2027-06-30', kind = 'insurance',
                     athlete_id = null, program_id = '00000000-0000-0000-0000-000000000043'
                     where id = 'a0000000-0000-0000-0000-0000000000d9' returning 1) select count(*)::text from u$q$);
  perform pr.ok(v = 'OK:1', 'org A admin edits document metadata and visibility (' || v || ')');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.documents set family_id = 'b0000000-0000-0000-0000-0000000000d1'
           where id = 'a0000000-0000-0000-0000-0000000000d9' returning id::text$q$);
  perform pr.ok(v like 'ERR:%CROSS_TENANT%', 'org A admin cannot scope a document to an org B family');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$with u as (update public.documents set title = 'Finance' where id = 'a0000000-0000-0000-0000-0000000000d9' returning 1) select count(*)::text from u$q$);
  perform pr.ok(v = 'OK:0', 'finance cannot edit documents (' || v || ')');
end $$;

-- ===========================================================================
-- D. family_members: org-scoped admin links
-- ===========================================================================
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000c2', 'guardian-a2@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001' where id = 'a0000000-0000-0000-0000-0000000000c2';

do $$
declare v text;
begin
  v := pr.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$select count(*)::text from public.family_members where family_id = '00000000-0000-0000-0000-000000000061'$q$);
  perform pr.ok(v = 'OK:0', 'org B admin cannot list org A guardian links (' || v || ')');
  v := pr.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$insert into public.family_members (family_id, profile_id, relation) values ('00000000-0000-0000-0000-000000000061', 'b0000000-0000-0000-0000-0000000000c1', 'guardian') returning 1$q$);
  perform pr.ok(v like 'ERR:%', 'org B admin cannot attach itself as guardian of an org A family');
  v := pr.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$with d as (delete from public.family_members where family_id = '00000000-0000-0000-0000-000000000061' returning 1) select count(*)::text from d$q$);
  perform pr.ok(v = 'OK:0', 'org B admin cannot remove org A guardian links (' || v || ')');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.family_members (family_id, profile_id, relation) values ('00000000-0000-0000-0000-000000000062', 'b0000000-0000-0000-0000-0000000000c1', 'guardian') returning 1$q$);
  perform pr.ok(v like 'ERR:%', 'org A admin cannot link a profile from another org as guardian');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.family_members (family_id, profile_id, relation) values ('00000000-0000-0000-0000-000000000062', 'a0000000-0000-0000-0000-0000000000c2', 'guardian') returning relation$q$);
  perform pr.ok(v = 'OK:guardian', 'org A admin links one of its profiles as guardian (' || v || ')');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.family_members set relation = 'mother', is_primary = true where family_id = '00000000-0000-0000-0000-000000000062' and profile_id = 'a0000000-0000-0000-0000-0000000000c2' returning 1) select count(*)::text from u$q$);
  perform pr.ok(v = 'OK:1', 'org A admin edits the guardian relation (' || v || ')');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$insert into public.family_members (family_id, profile_id, relation) values ('00000000-0000-0000-0000-000000000061', 'a0000000-0000-0000-0000-0000000000c2', 'guardian') returning 1$q$);
  perform pr.ok(v like 'ERR:%', 'finance cannot change guardian links');
end $$;

-- ===========================================================================
-- E. Consents: manual records (append-only) and withdrawal with reason
-- ===========================================================================
do $$
declare v text; v_id uuid; v_before int;
begin
  select count(*) into v_before from public.consent_acceptances where athlete_id = '00000000-0000-0000-0000-000000000072';
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.consent_acceptances (org_id, athlete_id, consent_form_id, accepted_version, accepted_at,
                                                 status, source, recorded_by, signer_name)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072',
                  '00000000-0000-0000-0000-000000000031', 1, '2026-09-01 10:00+02', 'accepted', 'paper',
                  '00000000-0000-0000-0000-0000000000f1', 'Synthetic Signer') returning id::text$q$);
  perform pr.ok(v like 'OK:%', 'admin records a paper consent (' || left(v, 40) || ')');
  v_id := substr(v, 4)::uuid;
  perform pr.ok((select accepted_text is not null and source = 'paper' and accepted_at = '2026-09-01 10:00+02'
                   from public.consent_acceptances where id = v_id),
                'paper consent keeps its signing date, source and wording snapshot');

  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$update public.consent_acceptances set signer_name = 'Changed' where id = %L returning 1$q$, v_id));
  perform pr.ok(v like 'ERR:%' or v = 'OK:<null>', 'a recorded consent cannot be edited by an admin (' || left(v, 40) || ')');
  v := pr.run_as(null, format($q$update public.consent_acceptances set signer_name = 'Changed' where id = %L returning 1$q$, v_id));
  perform pr.ok(v like 'ERR:%immutable%', 'not even the service role can rewrite a consent record');
  v := pr.run_as(null, format($q$delete from public.consent_acceptances where id = %L returning 1$q$, v_id));
  perform pr.ok(v like 'ERR:%immutable%', 'consent records cannot be deleted');

  v := pr.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$insert into public.consent_acceptances (org_id, athlete_id, consent_form_id, accepted_version, status, source)
          values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000072',
                  'b0000000-0000-0000-0000-0000000000f1', 1, 'accepted', 'paper') returning 1$q$);
  perform pr.ok(v like 'ERR:%', 'org B admin cannot record a consent for an org A athlete');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.consent_acceptances (org_id, athlete_id, consent_form_id, accepted_version, status, source)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072',
                  'b0000000-0000-0000-0000-0000000000f1', 1, 'accepted', 'paper') returning 1$q$);
  perform pr.ok(v like 'ERR:%CROSS_TENANT%', 'org A admin cannot record against an org B consent form');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$insert into public.consent_acceptances (org_id, athlete_id, consent_form_id, accepted_version, status, source)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072',
                  '00000000-0000-0000-0000-000000000031', 1, 'accepted', 'paper') returning 1$q$);
  perform pr.ok(v like 'ERR:%', 'finance cannot record consents');

  -- Withdrawal
  v := pr.run_as('b0000000-0000-0000-0000-0000000000c1',
       format($q$select public.withdraw_consent_with_reason(%L, 'Synthetic reason')::text$q$, v_id));
  perform pr.ok(v like 'ERR:%NOT_FOUND%', 'org B admin cannot withdraw an org A consent');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f2',
       format($q$select public.withdraw_consent_with_reason(%L, 'Synthetic reason')::text$q$, v_id));
  perform pr.ok(v like 'ERR:%FORBIDDEN%', 'finance cannot withdraw consents');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$select public.withdraw_consent_with_reason(%L, '  ')::text$q$, v_id));
  perform pr.ok(v like 'ERR:%REASON_REQUIRED%', 'withdrawal needs a reason');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$select public.withdraw_consent_with_reason(%L, 'Parent withdrew by letter')::text$q$, v_id));
  perform pr.ok(v like 'OK:%withdrawn%', 'admin withdraws a consent with a reason (' || v || ')');
  perform pr.ok((select status = 'withdrawn' and withdrawal_reason = 'Parent withdrew by letter'
                        and withdrawn_by = '00000000-0000-0000-0000-0000000000f1' and withdrawn_at is not null
                   from public.consent_acceptances where id = v_id),
                'withdrawal stores reason, actor and time');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$select public.withdraw_consent_with_reason(%L, 'Again')::text$q$, v_id));
  perform pr.ok(v like 'ERR:%NOT_ACTIVE%', 'a withdrawn consent cannot be withdrawn again');
  v := pr.run_as(null, format($q$update public.consent_acceptances set status = 'accepted' where id = %L returning 1$q$, v_id));
  perform pr.ok(v like 'ERR:%immutable%', 'a withdrawn consent cannot be re-activated in place');
  perform pr.ok((select count(*) from public.consent_acceptances where athlete_id = '00000000-0000-0000-0000-000000000072') = v_before + 1,
                'history kept: the withdrawn record is still there');

  -- Guardian Carla may withdraw her own child's consent, not others.
  v := pr.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.withdraw_consent_with_reason(id, 'Synthetic guardian reason')::text
            from public.consent_acceptances where athlete_id = '00000000-0000-0000-0000-000000000071' and status = 'accepted' limit 1$q$);
  perform pr.ok(v like 'OK:%withdrawn%', 'guardian withdraws her own child''s consent with a reason');
end $$;

-- ===========================================================================
-- F. Audit trail for athletes / families
-- ===========================================================================
do $$
declare v text;
begin
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.athletes set school = 'Synthetic school' where id = '00000000-0000-0000-0000-000000000072' returning 1) select count(*)::text from u$q$);
  perform pr.ok(exists (select 1 from public.audit_logs where target_table = 'athletes'
                          and target_id = '00000000-0000-0000-0000-000000000072' and action = 'UPDATE'
                          and actor_id = '00000000-0000-0000-0000-0000000000f1'),
                'athlete edit is audited with the actor');
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.families set contact_name = 'Synthetic contact' where id = '00000000-0000-0000-0000-000000000062' returning 1) select count(*)::text from u$q$);
  perform pr.ok(exists (select 1 from public.audit_logs where target_table = 'families'
                          and target_id = '00000000-0000-0000-0000-000000000062' and action = 'UPDATE'),
                'family edit is audited');
  v := pr.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$select count(*)::text from public.audit_logs where target_table in ('athletes','families') and org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform pr.ok(v = 'OK:0', 'org B admin reads no org A audit rows (' || v || ')');
end $$;

-- ===========================================================================
-- G. anonymise_family clears photos
-- ===========================================================================
do $$
declare v text; v_res jsonb;
begin
  v := pr.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.anonymise_family('00000000-0000-0000-0000-000000000061')::text$q$);
  perform pr.ok(v like 'OK:%', 'org A admin anonymises a family');
  v_res := substr(v, 4)::jsonb;
  perform pr.ok(v_res->'photo_paths' @> '["00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000071/p1.jpg"]'::jsonb,
                'photo paths are returned for object removal (' || coalesce(v_res->>'photo_paths', '<null>') || ')');
  perform pr.ok((select photo_path is null from public.athletes where id = '00000000-0000-0000-0000-000000000071'),
                'athlete photo path cleared');
  perform pr.ok((select photo_path is not null from public.athletes where id = '00000000-0000-0000-0000-000000000072'),
                'other families keep their photos');
end $$;
