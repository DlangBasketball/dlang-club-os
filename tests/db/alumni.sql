-- ============================================================================
-- Alumni & placements suite (migration 20250420102800_alumni_placements.sql)
--
--   A. Access: admin reads and writes; a coach only with alumni_access (and
--      cannot grant it to himself); finance and guardians are denied on every
--      table and verb.
--   B. Cross-tenant denial on every table (select / insert / update / delete)
--      and cross-org references refused.
--   C. Rules: guardian contact required while possibly a minor (birth year
--      rule and full birth date), consent dates, do-not-contact blocks
--      outbound contact log entries, authors are server-set.
--   D. Delete cascades placements and contact log (no orphans); the audit
--      trail holds no personal data.
--   E. alumni_public_showcase: consented adults (or guardian consent) only,
--      only when the club switched the "placements" section on, name style.
--   F. Feature key mirrored in plans.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3 =
-- coach row …011, guardian …f4, athlete …071). Org B …0002 from
-- seed_tenants.sql; its admin is created here.
-- SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema alu;
grant usage on schema alu to authenticated, anon, service_role;
create table alu.ctx (k text primary key, v text);
grant all on alu.ctx to authenticated, anon, service_role;

create function alu.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p (null = service_role, the website's server-side reader;
-- p_anon = true: anonymous). Returns 'OK:<first column>' or 'ERR:<message>'.
create function alu.run_as(p uuid, p_sql text, p_anon boolean default false) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    if p_anon then execute 'set local role anon';
    elsif p is null then execute 'set local role service_role';
    else execute 'set local role authenticated'; end if;
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
grant execute on all functions in schema alu to authenticated, anon, service_role;

-- Org B admin (synthetic).
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000003c1', 'alu-admin-b@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id = 'b0000000-0000-0000-0000-0000000003c1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000003c1', 'admin');

-- ===========================================================================
-- A. Access
-- ===========================================================================
do $$
declare v text;
  admin_a   uuid := '00000000-0000-0000-0000-0000000000f1';
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  coach_a   uuid := '00000000-0000-0000-0000-0000000000f3';
  guardian  uuid := '00000000-0000-0000-0000-0000000000f4';
begin
  v := alu.run_as(admin_a, $q$insert into public.alumni (org_id, first_name, last_name, birth_year, email, phone, whatsapp,
         contact_consent, contact_consent_on, contact_consent_source, tags)
       values ('00000000-0000-0000-0000-000000000001', 'Synthetic', 'Adult', 2001, ' Synth.Adult@Example.TEST ', '+41 79 000 00 01', true,
         true, '2026-01-10', 'In person', array['ncaa', ' ncaa ', '']) returning id$q$);
  perform alu.ok(v like 'OK:%', 'admin adds an alumnus (' || v || ')');
  insert into alu.ctx values ('adult', substr(v, 4));
  perform alu.ok((select email = 'synth.adult@example.test' and tags = '{ncaa}' and created_by = admin_a
                    from public.alumni where id = substr(v, 4)::uuid),
                 'email normalised, tags de-duplicated, author server-set');

  v := alu.run_as(admin_a, format($q$insert into public.alumni_placements (org_id, alumni_id, institution, institution_type, country,
         league, start_date, end_year, scholarship, status, is_current)
       values ('00000000-0000-0000-0000-000000000001', %L, 'Synthetic State University', 'ncaa_d1', 'USA', 'Synthetic Conference',
         '2023-08-15', 2027, 'full', 'enrolled', true) returning id$q$, substr(v, 4)));
  perform alu.ok(v like 'OK:%', 'admin adds a placement (' || v || ')');
  insert into alu.ctx values ('placement', substr(v, 4));

  v := alu.run_as(admin_a, format($q$insert into public.alumni_contacts (org_id, alumni_id, kind, direction, summary, follow_up_on, by_user)
       values ('00000000-0000-0000-0000-000000000001', %L, 'call', 'outbound', 'Synthetic call summary', current_date + 7,
               '00000000-0000-0000-0000-0000000000f2') returning by_user::text$q$, (select c.v from alu.ctx c where c.k = 'adult')));
  perform alu.ok(v = 'OK:' || admin_a::text, 'contact log author is the signed-in user, not the client value (' || v || ')');

  -- coach without the flag
  v := alu.run_as(coach_a, $q$select count(*)::text from public.alumni$q$);
  perform alu.ok(v = 'OK:0', 'coach without alumni access reads nothing (' || v || ')');
  v := alu.run_as(coach_a, $q$insert into public.alumni (org_id, first_name, last_name) values ('00000000-0000-0000-0000-000000000001', 'No', 'Access') returning id$q$);
  perform alu.ok(v like 'ERR:%', 'coach without alumni access cannot insert (' || v || ')');
  v := alu.run_as(coach_a, $q$update public.coaches set alumni_access = true where profile_id = auth.uid() returning id$q$);
  perform alu.ok(v = 'OK:<null>', 'coach cannot grant himself alumni access (' || v || ')');

  -- finance + guardian: denied everywhere
  foreach v in array array[
    alu.run_as(finance_a, $q$select count(*)::text from public.alumni$q$),
    alu.run_as(finance_a, $q$select count(*)::text from public.alumni_placements$q$),
    alu.run_as(finance_a, $q$select count(*)::text from public.alumni_contacts$q$),
    alu.run_as(guardian, $q$select count(*)::text from public.alumni$q$),
    alu.run_as(guardian, $q$select count(*)::text from public.alumni_placements$q$),
    alu.run_as(guardian, $q$select count(*)::text from public.alumni_contacts$q$)] loop
    perform alu.ok(v = 'OK:0', 'finance / guardian read nothing (' || v || ')');
  end loop;
  v := alu.run_as(finance_a, $q$insert into public.alumni (org_id, first_name, last_name) values ('00000000-0000-0000-0000-000000000001', 'Fin', 'Ance') returning id$q$);
  perform alu.ok(v like 'ERR:%', 'finance cannot insert (' || v || ')');
  v := alu.run_as(guardian, $q$insert into public.alumni (org_id, first_name, last_name) values ('00000000-0000-0000-0000-000000000001', 'Par', 'Ent') returning id$q$);
  perform alu.ok(v like 'ERR:%', 'guardian cannot insert (' || v || ')');
  v := alu.run_as(finance_a, format($q$update public.alumni set notes = 'x' where id = %L returning id$q$, (select c.v from alu.ctx c where c.k = 'adult')));
  perform alu.ok(v = 'OK:<null>', 'finance cannot update (' || v || ')');
  v := alu.run_as(guardian, format($q$delete from public.alumni_placements where id = %L returning id$q$, (select c.v from alu.ctx c where c.k = 'placement')));
  perform alu.ok(v = 'OK:<null>', 'guardian cannot delete a placement (' || v || ')');
  v := alu.run_as(finance_a, $q$delete from public.alumni_contacts returning id$q$);
  perform alu.ok(v = 'OK:<null>', 'finance cannot delete contact log rows (' || v || ')');
  v := alu.run_as(null, $q$select count(*)::text from public.alumni$q$, true);
  perform alu.ok(v like 'ERR:%' or v = 'OK:0', 'anonymous visitors cannot read alumni (' || v || ')');
  v := alu.run_as(null, $q$select count(*)::text from public.alumni_public_showcase('00000000-0000-0000-0000-000000000001')$q$, true);
  perform alu.ok(v like 'ERR:%permission denied%', 'anonymous callers cannot call the showcase directly (' || v || ')');
  v := alu.run_as(null, $q$select public.alumni_staff_can()::text$q$, true);
  perform alu.ok(v like 'ERR:%permission denied%', 'anonymous callers cannot call alumni_staff_can (' || v || ')');
end $$;

-- coach WITH the flag (set by the admin)
do $$
declare v text;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  coach_a uuid := '00000000-0000-0000-0000-0000000000f3';
begin
  v := alu.run_as(admin_a, $q$update public.coaches set alumni_access = true where id = '00000000-0000-0000-0000-000000000011' returning alumni_access::text$q$);
  perform alu.ok(v = 'OK:true', 'admin grants alumni access to a coach (' || v || ')');
  v := alu.run_as(coach_a, $q$select count(*)::text from public.alumni$q$);
  perform alu.ok(v = 'OK:1', 'coach with alumni access reads the list (' || v || ')');
  v := alu.run_as(coach_a, $q$insert into public.alumni (org_id, first_name, last_name, birth_year)
       values ('00000000-0000-0000-0000-000000000001', 'Coach', 'Added', 1999) returning id$q$);
  perform alu.ok(v like 'OK:%', 'coach with alumni access adds an alumnus (' || v || ')');
  insert into alu.ctx values ('coach_row', substr(v, 4));
  v := alu.run_as(coach_a, format($q$insert into public.alumni_contacts (org_id, alumni_id, kind, summary) values
       ('00000000-0000-0000-0000-000000000001', %L, 'note', 'Synthetic note') returning id$q$, substr(v, 4)));
  perform alu.ok(v like 'OK:%', 'coach with alumni access logs a contact (' || v || ')');
  v := alu.run_as(coach_a, format($q$delete from public.alumni where id = %L returning id$q$, (select c.v from alu.ctx c where c.k = 'coach_row')));
  perform alu.ok(v like 'OK:%' and v <> 'OK:<null>', 'coach with alumni access deletes (' || v || ')');
  v := alu.run_as(admin_a, $q$update public.coaches set alumni_access = false where id = '00000000-0000-0000-0000-000000000011' returning id$q$);
  v := alu.run_as(coach_a, $q$select count(*)::text from public.alumni$q$);
  perform alu.ok(v = 'OK:0', 'access ends when the admin removes the flag (' || v || ')');
end $$;

-- ===========================================================================
-- B. Cross-tenant denial
-- ===========================================================================
do $$
declare v text;
  admin_b uuid := 'b0000000-0000-0000-0000-0000000003c1';
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  v_adult text := (select c.v from alu.ctx c where c.k = 'adult');
  v_pl text := (select c.v from alu.ctx c where c.k = 'placement');
begin
  foreach v in array array[
    alu.run_as(admin_b, $q$select count(*)::text from public.alumni$q$),
    alu.run_as(admin_b, $q$select count(*)::text from public.alumni_placements$q$),
    alu.run_as(admin_b, $q$select count(*)::text from public.alumni_contacts$q$)] loop
    perform alu.ok(v = 'OK:0', 'org B admin reads no org A alumni data (' || v || ')');
  end loop;
  v := alu.run_as(admin_b, format($q$update public.alumni set notes = 'hijack' where id = %L returning id$q$, v_adult));
  perform alu.ok(v = 'OK:<null>', 'org B admin cannot update an org A alumnus (' || v || ')');
  v := alu.run_as(admin_b, format($q$update public.alumni_placements set institution = 'x' where id = %L returning id$q$, v_pl));
  perform alu.ok(v = 'OK:<null>', 'org B admin cannot update an org A placement (' || v || ')');
  v := alu.run_as(admin_b, $q$update public.alumni_contacts set summary = 'x' returning id$q$);
  perform alu.ok(v = 'OK:<null>', 'org B admin cannot update org A contact log (' || v || ')');
  v := alu.run_as(admin_b, format($q$delete from public.alumni where id = %L returning id$q$, v_adult));
  perform alu.ok(v = 'OK:<null>', 'org B admin cannot delete an org A alumnus (' || v || ')');
  v := alu.run_as(admin_b, format($q$delete from public.alumni_placements where id = %L returning id$q$, v_pl));
  perform alu.ok(v = 'OK:<null>', 'org B admin cannot delete an org A placement (' || v || ')');
  v := alu.run_as(admin_b, $q$delete from public.alumni_contacts returning id$q$);
  perform alu.ok(v = 'OK:<null>', 'org B admin cannot delete org A contact log (' || v || ')');
  v := alu.run_as(admin_b, $q$insert into public.alumni (org_id, first_name, last_name) values ('00000000-0000-0000-0000-000000000001', 'Into', 'OrgA') returning id$q$);
  perform alu.ok(v like 'ERR:%', 'org B admin cannot insert into org A (' || v || ')');
  v := alu.run_as(admin_b, format($q$insert into public.alumni_placements (org_id, alumni_id, institution) values ('10000000-0000-0000-0000-000000000002', %L, 'x') returning id$q$, v_adult));
  perform alu.ok(v like 'ERR:%', 'org B admin cannot attach a placement to an org A alumnus (' || v || ')');
  v := alu.run_as(admin_b, format($q$insert into public.alumni_contacts (org_id, alumni_id, summary) values ('10000000-0000-0000-0000-000000000002', %L, 'x') returning id$q$, v_adult));
  perform alu.ok(v like 'ERR:%', 'org B admin cannot log contact on an org A alumnus (' || v || ')');
  v := alu.run_as(admin_b, $q$insert into public.alumni (org_id, first_name, last_name, athlete_id) values ('10000000-0000-0000-0000-000000000002', 'Steal', 'Link', '00000000-0000-0000-0000-000000000071') returning id$q$);
  perform alu.ok(v like 'ERR:%CROSS_ORG_REFERENCE%', 'org B cannot link an org A athlete (' || v || ')');
  v := alu.run_as(admin_b, $q$insert into public.alumni (org_id, first_name, last_name) values ('10000000-0000-0000-0000-000000000002', 'Synthetic', 'Borg') returning id$q$);
  perform alu.ok(v like 'OK:%', 'org B admin manages its own alumni (' || v || ')');
  v := alu.run_as(admin_a, $q$select count(*)::text from public.alumni where org_id = '10000000-0000-0000-0000-000000000002'$q$);
  perform alu.ok(v = 'OK:0', 'org A admin does not see org B alumni (' || v || ')');
  v := alu.run_as(admin_a, format($q$update public.alumni set org_id = '10000000-0000-0000-0000-000000000002' where id = %L returning id$q$, v_adult));
  perform alu.ok(v like 'ERR:%', 'an alumnus cannot be moved to another club (' || v || ')');
end $$;

-- ===========================================================================
-- C. Rules
-- ===========================================================================
do $$
declare v text;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  v_year int := extract(year from current_date)::int;
begin
  perform alu.ok(public.alumni_is_minor(v_year - 16, null) and public.alumni_is_minor(v_year - 18, null)
                 and not public.alumni_is_minor(v_year - 19, null) and not public.alumni_is_minor(null, null),
                 'birth-year rule: possibly a minor until the year they turn 19');
  perform alu.ok(not public.alumni_is_minor(v_year - 18, (current_date - interval '18 years')::date)
                 and public.alumni_is_minor(v_year - 18, (current_date - interval '18 years' + interval '1 day')::date),
                 'a full birth date decides exactly (18th birthday)');
  v := alu.run_as(admin_a, format($q$insert into public.alumni (org_id, first_name, last_name, birth_year)
       values ('00000000-0000-0000-0000-000000000001', 'Young', 'Prospect', %s) returning id$q$, v_year - 16));
  perform alu.ok(v like 'ERR:%ALUMNI_GUARDIAN_REQUIRED%', 'a minor needs a guardian contact (' || v || ')');
  v := alu.run_as(admin_a, format($q$insert into public.alumni (org_id, first_name, last_name, birth_year, guardian_name)
       values ('00000000-0000-0000-0000-000000000001', 'Young', 'Prospect', %s, 'Synthetic Guardian') returning id$q$, v_year - 16));
  perform alu.ok(v like 'ERR:%ALUMNI_GUARDIAN_REQUIRED%', 'a guardian name alone is not enough (' || v || ')');
  v := alu.run_as(admin_a, format($q$insert into public.alumni (org_id, first_name, last_name, birth_year, guardian_name, guardian_email,
         showcase_consent, showcase_consent_on)
       values ('00000000-0000-0000-0000-000000000001', 'Young', 'Prospect', %s, 'Synthetic Guardian', 'guardian@example.test', true, current_date) returning id$q$, v_year - 16));
  perform alu.ok(v like 'OK:%', 'a minor with a guardian contact is accepted (' || v || ')');
  insert into alu.ctx values ('minor', substr(v, 4));
  v := alu.run_as(admin_a, format($q$update public.alumni set guardian_email = null where id = %L returning id$q$, substr(v, 4)));
  perform alu.ok(v like 'ERR:%ALUMNI_GUARDIAN_REQUIRED%', 'the guardian contact cannot be removed while a minor (' || v || ')');
  v := alu.run_as(admin_a, $q$insert into public.alumni (org_id, first_name, last_name, contact_consent) values ('00000000-0000-0000-0000-000000000001', 'No', 'Date', true) returning id$q$);
  perform alu.ok(v like 'ERR:%', 'contact consent needs a date (' || v || ')');
  v := alu.run_as(admin_a, $q$insert into public.alumni (org_id, first_name, last_name, showcase_consent) values ('00000000-0000-0000-0000-000000000001', 'No', 'Date', true) returning id$q$);
  perform alu.ok(v like 'ERR:%', 'showcase consent needs a date (' || v || ')');
  v := alu.run_as(admin_a, $q$insert into public.alumni (org_id, first_name, last_name, email) values ('00000000-0000-0000-0000-000000000001', 'Bad', 'Email', 'not-an-email') returning id$q$);
  perform alu.ok(v like 'ERR:%', 'an invalid email is refused (' || v || ')');
  v := alu.run_as(admin_a, $q$insert into public.alumni (org_id, first_name, last_name, highlight_url) values ('00000000-0000-0000-0000-000000000001', 'Bad', 'Url', 'javascript:alert(1)') returning id$q$);
  perform alu.ok(v like 'ERR:%', 'a non-http highlight link is refused (' || v || ')');
  v := alu.run_as(admin_a, $q$insert into public.alumni (org_id, first_name, last_name, photo_path) values ('00000000-0000-0000-0000-000000000001', 'Bad', 'Photo', '10000000-0000-0000-0000-000000000002/gallery/x.jpg') returning id$q$);
  perform alu.ok(v like 'ERR:%', 'a photo from another club''s media is refused (' || v || ')');
  v := alu.run_as(admin_a, format($q$insert into public.alumni_placements (org_id, alumni_id, institution, institution_type) values ('00000000-0000-0000-0000-000000000001', %L, 'X', 'ncaa_d4') returning id$q$,
       (select c.v from alu.ctx c where c.k = 'adult')));
  perform alu.ok(v like 'ERR:%', 'an unknown institution type is refused (' || v || ')');
  v := alu.run_as(admin_a, format($q$insert into public.alumni_placements (org_id, alumni_id, institution, scholarship) values ('00000000-0000-0000-0000-000000000001', %L, 'X', 'half') returning id$q$,
       (select c.v from alu.ctx c where c.k = 'adult')));
  perform alu.ok(v like 'ERR:%', 'an unknown scholarship value is refused (' || v || ')');
end $$;

-- do not contact
do $$
declare v text;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  v_id text;
begin
  v := alu.run_as(admin_a, $q$insert into public.alumni (org_id, first_name, last_name, birth_year, status, email)
       values ('00000000-0000-0000-0000-000000000001', 'Quiet', 'Please', 1995, 'do_not_contact', 'quiet@example.test') returning id$q$);
  v_id := substr(v, 4);
  insert into alu.ctx values ('dnc', v_id);
  v := alu.run_as(admin_a, format($q$insert into public.alumni_contacts (org_id, alumni_id, kind, direction, summary) values ('00000000-0000-0000-0000-000000000001', %L, 'email', 'outbound', 'x') returning id$q$, v_id));
  perform alu.ok(v like 'ERR:%ALUMNI_DO_NOT_CONTACT%', 'do not contact blocks an outbound email (' || v || ')');
  v := alu.run_as(admin_a, format($q$insert into public.alumni_contacts (org_id, alumni_id, kind, direction, summary) values ('00000000-0000-0000-0000-000000000001', %L, 'call', 'outbound', 'x') returning id$q$, v_id));
  perform alu.ok(v like 'ERR:%ALUMNI_DO_NOT_CONTACT%', 'do not contact blocks an outbound call (' || v || ')');
  v := alu.run_as(admin_a, format($q$insert into public.alumni_contacts (org_id, alumni_id, kind, direction, summary) values ('00000000-0000-0000-0000-000000000001', %L, 'whatsapp', 'outbound', 'x') returning id$q$, v_id));
  perform alu.ok(v like 'ERR:%ALUMNI_DO_NOT_CONTACT%', 'do not contact blocks an outbound WhatsApp (' || v || ')');
  v := alu.run_as(admin_a, format($q$insert into public.alumni_contacts (org_id, alumni_id, kind, direction, summary) values ('00000000-0000-0000-0000-000000000001', %L, 'email', 'inbound', 'They wrote to us') returning id$q$, v_id));
  perform alu.ok(v like 'OK:%', 'an inbound message can still be logged (' || v || ')');
  v := alu.run_as(admin_a, format($q$insert into public.alumni_contacts (org_id, alumni_id, kind, direction, summary) values ('00000000-0000-0000-0000-000000000001', %L, 'note', 'none', 'Internal note') returning id$q$, v_id));
  perform alu.ok(v like 'OK:%', 'an internal note can still be logged (' || v || ')');
end $$;

-- ===========================================================================
-- D. Delete cascades + anonymised audit
-- ===========================================================================
do $$
declare v text;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  v_id uuid := (select c.v::uuid from alu.ctx c where c.k = 'adult');
begin
  perform alu.ok((select count(*) from public.alumni_placements where alumni_id = v_id) = 1
                 and (select count(*) from public.alumni_contacts where alumni_id = v_id) = 1, 'fixture: one placement and one contact');
  v := alu.run_as(admin_a, format($q$update public.alumni set notes = 'Synthetic private note', status = 'lost_touch' where id = %L returning status$q$, v_id));
  perform alu.ok(v = 'OK:lost_touch', 'admin updates the alumnus (' || v || ')');
  v := alu.run_as(admin_a, format($q$delete from public.alumni where id = %L returning id$q$, v_id));
  perform alu.ok(v = 'OK:' || v_id::text, 'admin deletes the alumnus permanently (' || v || ')');
  perform alu.ok(not exists (select 1 from public.alumni where id = v_id), 'alumnus gone');
  perform alu.ok(not exists (select 1 from public.alumni_placements where alumni_id = v_id), 'placements deleted with it (no orphans)');
  perform alu.ok(not exists (select 1 from public.alumni_contacts where alumni_id = v_id), 'contact log deleted with it (no orphans)');
  perform alu.ok(not exists (select 1 from public.alumni_placements p where not exists (select 1 from public.alumni a where a.id = p.alumni_id))
                 and not exists (select 1 from public.alumni_contacts c where not exists (select 1 from public.alumni a where a.id = c.alumni_id)),
                 'no orphan placements or contact rows anywhere');
  perform alu.ok(exists (select 1 from public.audit_logs where target_id = v_id and action = 'alumni.delete'), 'the delete is audited');
  perform alu.ok(not exists (select 1 from public.audit_logs where target_table like 'alumni%'
                               and (coalesce(old_data::text, '') || coalesce(new_data::text, '')) ~* '(synth\.adult|Synthetic State|\+41 79|Adult|private note|lost_touch)'),
                 'the audit trail holds no personal data');
  perform alu.ok(exists (select 1 from public.audit_logs where target_table = 'alumni' and action = 'alumni.update' and new_data ? 'changed'),
                 'updates record the changed column names only');
end $$;

-- ===========================================================================
-- E. Public showcase
-- ===========================================================================
do $$
declare v text;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  v_full uuid; v_init uuid; v_noage uuid; v_noconsent uuid; v_minor uuid := (select c.v::uuid from alu.ctx c where c.k = 'minor');
begin
  insert into public.alumni (id, org_id, first_name, last_name, birth_year, showcase_consent, showcase_consent_on, showcase_name_style)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Fulla', 'Showcase', 2000, true, current_date, 'full') returning id into v_full;
  insert into public.alumni (org_id, first_name, last_name, birth_year, showcase_consent, showcase_consent_on)
  values ('00000000-0000-0000-0000-000000000001', 'Inita', 'Showcase', 2001, true, current_date) returning id into v_init;
  insert into public.alumni (org_id, first_name, last_name, showcase_consent, showcase_consent_on)
  values ('00000000-0000-0000-0000-000000000001', 'Noage', 'Unknown', true, current_date) returning id into v_noage;
  insert into public.alumni (org_id, first_name, last_name, birth_year)
  values ('00000000-0000-0000-0000-000000000001', 'Private', 'Person', 2000) returning id into v_noconsent;
  insert into public.alumni_placements (org_id, alumni_id, institution, institution_type, start_date, is_current, status) values
    ('00000000-0000-0000-0000-000000000001', v_full, 'Synthetic College', 'ncaa_d2', '2022-08-01', true, 'enrolled'),
    ('00000000-0000-0000-0000-000000000001', v_full, 'Old Prep', 'prep_academy', '2019-08-01', false, 'graduated'),
    ('00000000-0000-0000-0000-000000000001', v_init, 'Synthetic NAIA', 'naia', '2023-08-01', true, 'signed'),
    ('00000000-0000-0000-0000-000000000001', v_noage, 'Synthetic JUCO', 'junior_college', '2024-08-01', true, 'enrolled'),
    ('00000000-0000-0000-0000-000000000001', v_noconsent, 'Hidden U', 'ncaa_d1', '2024-08-01', true, 'enrolled'),
    ('00000000-0000-0000-0000-000000000001', v_minor, 'Synthetic High', 'high_school', '2025-08-01', true, 'enrolled');

  v := alu.run_as(null, $q$select count(*)::text from public.alumni_public_showcase('00000000-0000-0000-0000-000000000001')$q$);
  perform alu.ok(v = 'OK:0', 'nothing is shown until the club switches the placements section on (' || v || ')');

  insert into public.website_settings (org_id, enabled, public_sections)
  values ('00000000-0000-0000-0000-000000000001', true, '{"placements": true}'::jsonb)
  on conflict (org_id) do update set public_sections = website_settings.public_sections || '{"placements": true}'::jsonb;

  v := alu.run_as(null, $q$select string_agg(display_name || '|' || institution_type, ',' order by display_name) from public.alumni_public_showcase('00000000-0000-0000-0000-000000000001')$q$);
  perform alu.ok(v = 'OK:Fulla Showcase|ncaa_d2,Inita S.|naia', 'only consented adults, current placement, name per consent (' || v || ')');
  perform alu.ok(v not like '%Private%' and v not like '%Hidden%', 'no consent: not shown');
  perform alu.ok(v not like '%Young%', 'a minor without guardian showcase consent is not shown');
  perform alu.ok(v not like '%Noage%', 'unknown age without guardian consent is not shown');

  update public.alumni set showcase_guardian_consent = true where id = v_minor;
  v := alu.run_as(null, $q$select count(*)::text from public.alumni_public_showcase('00000000-0000-0000-0000-000000000001') where display_name = 'Young P.'$q$);
  perform alu.ok(v = 'OK:1', 'a minor is shown once the guardian consent is recorded (' || v || ')');

  update public.alumni set status = 'do_not_contact' where id = v_init;
  v := alu.run_as(null, $q$select count(*)::text from public.alumni_public_showcase('00000000-0000-0000-0000-000000000001') where display_name = 'Inita S.'$q$);
  perform alu.ok(v = 'OK:0', '"do not contact" also removes the person from the showcase (' || v || ')');

  v := alu.run_as(null, $q$select count(*)::text from public.alumni_public_showcase('10000000-0000-0000-0000-000000000002')$q$);
  perform alu.ok(v = 'OK:0', 'another club''s showcase does not leak org A rows (' || v || ')');
  v := alu.run_as(null, $q$select count(*)::text from public.alumni_public_showcase('00000000-0000-0000-0000-000000000001', 1)$q$);
  perform alu.ok(v = 'OK:1', 'the limit is respected (' || v || ')');
  v := alu.run_as(null, $q$select string_agg(t, ',') from (select jsonb_object_keys(to_jsonb(s)) t from public.alumni_public_showcase('00000000-0000-0000-0000-000000000001') s limit 11) x$q$);
  perform alu.ok(v not like '%email%' and v not like '%phone%' and v not like '%birth%', 'the showcase exposes no contact details or birth data (' || v || ')');
end $$;

-- ===========================================================================
-- F. Feature key
-- ===========================================================================
do $$
begin
  perform alu.ok(exists (select 1 from public.platform_features where key = 'alumni_network' and default_tier = 'academy'),
                 'feature key alumni_network registered (Academy)');
  perform alu.ok((select (features ->> 'alumni_network')::boolean from public.plans where code = 'academy')
                 and not (select (features ->> 'alumni_network')::boolean from public.plans where code = 'club'),
                 'included in Academy, not in Club');
end $$;
