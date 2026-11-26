-- ============================================================================
-- Public entry + guardian consent suite
-- (migration 20250420105900_public_entry_guardian_consent.sql)
--
--   1. family_bootstrap: a new account without an invitation gets a guest
--      family + parent access in the club of the slug; idempotent; org from
--      the slug only; never another club's data. handle_new_user with the
--      club_slug metadata does the same at sign-up.
--   2. register_public: a signed-in caller reuses their family and child (no
--      duplicate); club-approval programmes refused; anonymous path kept.
--   3. Third party: participant created in a holding guest family, booker not
--      a guardian, token stored as hash only, place held, guards (no confirm /
--      invoice while awaiting), booker status whitelist, booker reads nothing
--      of the child; accept with the wrong e-mail refused, right e-mail ->
--      guardian + consents + invoice to the booker; paying grants nothing.
--   4. Decline frees the place; 5. expiry after the hold frees the place.
--   6. Camp age rules: 7 -> camp approval after consent, 5 refused.
--   7. Training request held until consent (staff cannot confirm).
--   8. Existing child: no duplicate, request goes to its guardians only.
--   9. Cross-tenant denial for the new tables and RPCs.
--
-- Fixtures: seed.sql org A …0001 (admin …f1, coach …011/…012, Carla …f4 of
-- family …061 with Mateo …071); org B 10000000-…0002 (seed_tenants.sql).
-- SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema pe;
grant usage on schema pe to authenticated, anon, service_role;
create table pe.ctx (k text primary key, v text);
grant all on pe.ctx to authenticated, anon, service_role;

create function pe.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function pe.put(p_k text, p_v text) returns void language sql as $$
  insert into pe.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function pe.txt(p_k text) returns text language sql stable as $$ select v from pe.ctx where k = p_k $$;
create function pe.get(p_k text) returns uuid language sql stable as $$ select v::uuid from pe.ctx where k = p_k $$;
-- Run p_sql as a user (null = anon) or as the service role ('svc').
create function pe.run(p uuid, p_sql text, p_role text default null) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    if p_role = 'svc' then execute 'set local role service_role';
    elsif p is null then execute 'set local role anon';
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
create function pe.j(p_res text) returns jsonb language sql immutable as $$
  select case when p_res like 'OK:%' and p_res <> 'OK:<null>' then substr(p_res, 4)::jsonb end
$$;
create function pe.hash(p_token text) returns text language sql immutable as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;
grant execute on all functions in schema pe to authenticated, anon, service_role;

-- Fixtures -----------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000ee0a1', 'pe-new@example.test', now(), '{"full_name":"Synthetic Newcomer"}'),
  ('00000000-0000-0000-0000-0000000ee0a2', 'pe-booker@example.test', now(), '{"full_name":"Synthetic Booker"}'),
  ('00000000-0000-0000-0000-0000000ee0a3', 'pe-guardian@example.test', now(), '{"full_name":"Synthetic Guardian"}'),
  ('00000000-0000-0000-0000-0000000ee0a4', 'pe-wrong@example.test', now(), '{"full_name":"Synthetic Wrong"}'),
  ('00000000-0000-0000-0000-0000000ee0a5', 'pe-signup@example.test', now(), '{"full_name":"Synthetic Signup","club_slug":"dlang"}'),
  ('00000000-0000-0000-0000-0000000ee0a6', 'pe-guardian-two@example.test', now(), '{"full_name":"Synthetic Guardian Two"}'),
  ('b0000000-0000-0000-0000-0000000ee0f1', 'pe-admin-b@example.test', now(), '{"full_name":"Synthetic Admin B"}');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000ee0f1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000ee0f1', 'admin');
-- The booker is a parent of org A with their own family.
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001' where id = '00000000-0000-0000-0000-0000000ee0a2';
insert into public.families (id, org_id, name) values
  ('00000000-0000-0000-0000-0000000ee061', '00000000-0000-0000-0000-000000000001', 'Synthetic Booker Family');
insert into public.family_members (family_id, profile_id, relation, is_primary) values
  ('00000000-0000-0000-0000-0000000ee061', '00000000-0000-0000-0000-0000000ee0a2', 'guardian', true);

select pe.put('NEW', '00000000-0000-0000-0000-0000000ee0a1');
select pe.put('BOOKER', '00000000-0000-0000-0000-0000000ee0a2');
select pe.put('GUARD', '00000000-0000-0000-0000-0000000ee0a3');
select pe.put('WRONG', '00000000-0000-0000-0000-0000000ee0a4');
select pe.put('SIGNUP', '00000000-0000-0000-0000-0000000ee0a5');
select pe.put('GUARD2', '00000000-0000-0000-0000-0000000ee0a6');
select pe.put('BA', 'b0000000-0000-0000-0000-0000000ee0f1');
select pe.put('ADMIN', '00000000-0000-0000-0000-0000000000f1');
select pe.put('CARLA', '00000000-0000-0000-0000-0000000000f4');
select pe.put('MATEO', '00000000-0000-0000-0000-000000000071');
select pe.put('ORGA', '00000000-0000-0000-0000-000000000001');
select pe.put('start', (current_date + 30)::text);

-- Consent forms of org A: one required, one optional.
insert into public.consent_forms (org_id, key, title, body, version, is_required, is_active) values
  ('00000000-0000-0000-0000-000000000001', 'pe_terms', 'Synthetic terms', 'Synthetic body', 1, true, true),
  ('00000000-0000-0000-0000-000000000001', 'pe_media', 'Synthetic media', 'Synthetic body', 1, false, true);

-- Camp with an approval band (6-7) below the minimum age 8; weeks of capacity 1.
do $$
declare s date := pe.txt('start')::date;
begin
  insert into public.programs (id, org_id, slug, name, kind, price_chf, is_public, is_active, status, currency, min_age, max_age,
                               approval_age_min, approval_age_max)
  values ('00000000-0000-0000-0000-0000000ee041', '00000000-0000-0000-0000-000000000001', 'pe-camp', 'Synthetic Consent Camp',
          'camp', 0, true, true, 'published', 'CHF', 8, 14, 6, 7);
  insert into public.camp_editions (id, org_id, program_id, name, starts_on, ends_on, capacity, status) values
    ('00000000-0000-0000-0000-0000000ee0e1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ee041', 'W1', s, s + 4, 1, 'published'),
    ('00000000-0000-0000-0000-0000000ee0e2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ee041', 'W2', s + 7, s + 11, 1, 'published'),
    ('00000000-0000-0000-0000-0000000ee0e3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ee041', 'W3', s + 14, s + 18, 1, 'published'),
    ('00000000-0000-0000-0000-0000000ee0e4', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ee041', 'W4', s + 21, s + 25, null, 'published');
  insert into public.camp_age_groups (id, org_id, program_id, label, min_age, max_age) values
    ('00000000-0000-0000-0000-0000000ee0a0', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ee041', '6-14', 6, 14);
  insert into public.camp_price_options (id, org_id, program_id, edition_id, label, days_count, includes_lunch, price) values
    ('00000000-0000-0000-0000-0000000ee0c1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ee041', null, 'Full week', 5, true, 300);
end $$;

create function pe.days(p_edition uuid) returns jsonb language sql stable as $$
  select jsonb_agg(to_char(d, 'YYYY-MM-DD') order by d)
    from public.camp_editions e, generate_series(e.starts_on, e.ends_on, interval '1 day') d where e.id = p_edition
$$;
create function pe.hold(p_athlete uuid, p_edition uuid, p_token text) returns jsonb language sql stable as $$
  select jsonb_build_object('program_id', '00000000-0000-0000-0000-0000000ee041', 'edition_id', p_edition,
                            'athlete_id', p_athlete, 'age_group_id', '00000000-0000-0000-0000-0000000ee0a0',
                            'price_option_id', '00000000-0000-0000-0000-0000000ee0c1', 'days', pe.days(p_edition),
                            'token_hash', pe.hash(p_token))
$$;
create function pe.tp(p_first text, p_dob date, p_email text) returns jsonb language sql immutable as $$
  select jsonb_build_object('first_name', p_first, 'last_name', 'Thirdparty', 'dob', p_dob, 'gender', 'female',
                            'guardian_name', 'Synthetic Parent', 'guardian_email', p_email, 'guardian_phone', '+41 00 000 00 00',
                            'relation', 'friends_child')
$$;
create function pe.keys(p_request uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('accepted_keys', coalesce(jsonb_agg(f->>'key'), '[]'::jsonb))
    from public.guardian_consent_requests r, jsonb_array_elements(r.consent_forms) f where r.id = p_request
$$;
grant execute on all functions in schema pe to authenticated, anon, service_role;

-- ===========================================================================
-- 1. family_bootstrap
-- ===========================================================================
do $$
declare r text; v_fam uuid; n int;
begin
  perform pe.ok((select org_id from public.profiles where id = pe.get('NEW')) is null,
                'bootstrap: a sign-up without invitation starts with no club (the gap)');
  r := pe.run(pe.get('NEW'), $q$select public.family_bootstrap('dlang')::text$q$);
  v_fam := (pe.j(r)->>'family_id')::uuid;
  perform pe.ok(pe.j(r)->>'created' = 'true' and v_fam is not null, 'bootstrap: guest family created (' || r || ')');
  perform pe.ok((select membership_status from public.families where id = v_fam) = 'guest'
                and (select org_id from public.families where id = v_fam) = pe.get('ORGA'), 'bootstrap: family is a guest family of the slug''s club');
  perform pe.ok(exists (select 1 from public.family_members where family_id = v_fam and profile_id = pe.get('NEW') and is_primary),
                'bootstrap: the user is primary guardian');
  perform pe.ok((select org_id from public.profiles where id = pe.get('NEW')) = pe.get('ORGA'), 'bootstrap: profiles.org_id set (was null)');
  perform pe.ok(exists (select 1 from public.org_memberships where profile_id = pe.get('NEW') and org_id = pe.get('ORGA') and 'parent' = any(roles)),
                'bootstrap: parent org membership (parent app reachable)');
  perform pe.ok(pe.run(pe.get('NEW'), 'select public.is_any_guardian()::text') = 'OK:true', 'bootstrap: is_any_guardian() true for the new user');
  perform pe.ok(not exists (select 1 from public.memberships where family_id = v_fam)
                and not exists (select 1 from public.invoices where family_id = v_fam), 'bootstrap: no membership, no invoice granted');
  r := pe.run(pe.get('NEW'), $q$select public.family_bootstrap('DLANG')::text$q$);
  perform pe.ok(pe.j(r)->>'created' = 'false' and (pe.j(r)->>'family_id')::uuid = v_fam, 'bootstrap: idempotent (same family, case-insensitive slug)');
  select count(*) into n from public.family_members fm join public.families f on f.id = fm.family_id
   where fm.profile_id = pe.get('NEW') and f.org_id = pe.get('ORGA');
  perform pe.ok(n = 1, 'bootstrap: still one family');
  perform pe.ok(pe.run(pe.get('NEW'), $q$select public.family_bootstrap('no-such-club')::text$q$) like 'ERR:%CLUB_NOT_FOUND%', 'bootstrap: unknown slug refused');
  perform pe.ok(pe.run(null, $q$select public.family_bootstrap('dlang')::text$q$) like 'ERR:%', 'bootstrap: anon refused');
  perform pe.ok(pe.run(pe.get('NEW'), 'select count(*)::text from public.athletes') = 'OK:0', 'bootstrap: the guest family sees no other family''s child');
  -- Another club by its slug: a guest family there; the current club does not change; no data of B visible.
  r := pe.run(pe.get('NEW'), $q$select public.family_bootstrap('riverside')::text$q$);
  perform pe.ok(pe.j(r)->>'created' = 'true' and pe.j(r)->>'is_current' = 'false'
                and (select org_id from public.profiles where id = pe.get('NEW')) = pe.get('ORGA'),
                'bootstrap: another club -> its own guest family, current club unchanged');
  perform pe.ok(pe.run(pe.get('NEW'), $q$select count(*)::text from public.athletes where org_id = '10000000-0000-0000-0000-000000000002'$q$) = 'OK:0'
                and pe.run(pe.get('NEW'), $q$select count(*)::text from public.families where org_id = '10000000-0000-0000-0000-000000000002'$q$) = 'OK:0',
                'bootstrap: cannot read the other club''s data');
  -- handle_new_user with club_slug metadata.
  perform pe.ok((select org_id from public.profiles where id = pe.get('SIGNUP')) = pe.get('ORGA')
                and exists (select 1 from public.family_members fm join public.families f on f.id = fm.family_id
                             where fm.profile_id = pe.get('SIGNUP') and f.membership_status = 'guest' and f.org_id = pe.get('ORGA')),
                'handle_new_user: club_slug sign-up -> guest family in that club');
  perform pe.put('NEWFAM', v_fam::text);
end $$;

-- ===========================================================================
-- 2. register_public: no duplicate family / child for a signed-in caller
-- ===========================================================================
insert into public.programs (id, org_id, slug, name, kind, price_chf, is_public, is_active, status, currency, requires_club_approval) values
  ('00000000-0000-0000-0000-0000000ee051', '00000000-0000-0000-0000-000000000001', 'pe-tour-1', 'Synthetic Tournament 1', 'tournament', 50, true, true, 'published', 'CHF', false),
  ('00000000-0000-0000-0000-0000000ee052', '00000000-0000-0000-0000-000000000001', 'pe-tour-2', 'Synthetic Tournament 2', 'tournament', 50, true, true, 'published', 'CHF', false),
  ('00000000-0000-0000-0000-0000000ee053', '00000000-0000-0000-0000-000000000001', 'pe-club', 'Synthetic Club Programme', 'clinic', 50, true, true, 'published', 'CHF', true);
create function pe.reg(p_program uuid, p_account uuid, p_email text) returns jsonb language sql immutable as $$
  select jsonb_build_object('program_id', p_program, 'account_profile_id', p_account,
                            'parent', jsonb_build_object('name', 'Synthetic Newcomer', 'email', p_email, 'phone', '+41 00 000 00 01'),
                            'children', jsonb_build_array(jsonb_build_object('first_name', 'Synthetic', 'last_name', 'Dupcheck',
                                                                             'dob', '2015-04-04', 'gender', 'male')),
                            'consents', '[]'::jsonb)
$$;
grant execute on function pe.reg(uuid, uuid, text) to service_role;
do $$
declare r1 text; r2 text; n int;
begin
  r1 := pe.run(null, format('select public.register_public(%L)::text', pe.reg('00000000-0000-0000-0000-0000000ee051', pe.get('NEW'), 'other-typed@example.test')), 'svc');
  r2 := pe.run(null, format('select public.register_public(%L)::text', pe.reg('00000000-0000-0000-0000-0000000ee052', pe.get('NEW'), 'pe-new@example.test')), 'svc');
  perform pe.ok((pe.j(r1)->>'family_id')::uuid = pe.get('NEWFAM') and (pe.j(r2)->>'family_id')::uuid = pe.get('NEWFAM'),
                'register_public: a signed-in caller''s own family is reused (' || r1 || ')');
  perform pe.ok(pe.j(r1)->'athlete_ids'->>0 = pe.j(r2)->'athlete_ids'->>0, 'register_public: the same child is reused (no duplicate athlete)');
  select count(*) into n from public.athletes where family_id = pe.get('NEWFAM') and last_name = 'Dupcheck';
  perform pe.ok(n = 1, 'register_public: exactly one athlete record');
  perform pe.ok(not exists (select 1 from public.invitations where email = 'pe-new@example.test'), 'register_public: no invitation for an existing account');
  perform pe.ok(pe.run(null, format('select public.register_public(%L)::text', pe.reg('00000000-0000-0000-0000-0000000ee051', pe.get('NEW'), 'pe-new@example.test')), 'svc')
                like 'ERR:%ALREADY_REGISTERED%', 'register_public: the same child twice in a programme refused');
  perform pe.ok(pe.run(null, format('select public.register_public(%L)::text', pe.reg('00000000-0000-0000-0000-0000000ee053', pe.get('NEW'), 'pe-new@example.test')), 'svc')
                like 'ERR:%CLUB_APPROVAL_REQUIRED%', 'register_public: a club-approval programme is refused (club request path)');
  -- account_profile_id from a non-service caller is ignored (anonymous path).
  r1 := pe.run(pe.get('WRONG'), format('select public.register_public(%L)::text', pe.reg('00000000-0000-0000-0000-0000000ee051', pe.get('NEW'), 'pe-anon-path@example.test')));
  perform pe.ok((pe.j(r1)->>'family_id')::uuid <> pe.get('NEWFAM'), 'register_public: account id from a client is never trusted');
  r1 := pe.run(null, format('select public.register_public(%L)::text', pe.reg('00000000-0000-0000-0000-0000000ee052', null, 'pe-anon@example.test')), 'svc');
  perform pe.ok(pe.j(r1)->>'family_id' is not null and exists (select 1 from public.invitations where email = 'pe-anon@example.test'),
                'register_public: anonymous guest path unchanged (family by e-mail + invitation)');
end $$;

-- ===========================================================================
-- 3. Third party: participant, hold, guards, booker view, accept
-- ===========================================================================
do $$
declare r text; r2 text; v_ath uuid; v_req uuid; v_fam uuid; v_reg uuid; v_req_id uuid := gen_random_uuid(); s date := pe.txt('start')::date;
        row jsonb; v_keys text[];
begin
  perform pe.ok(pe.run(pe.get('BOOKER'), format('select public.third_party_participant_create(%L, %L)::text',
                pe.tp('Selfmail', (s - interval '10 years')::date, 'PE-Booker@example.test'), gen_random_uuid())) like 'ERR:%GUARDIAN_IS_BOOKER%',
                'third party: the guardian e-mail cannot be the booker''s own');
  perform pe.ok(pe.run(pe.get('BOOKER'), format('select public.third_party_participant_create(%L, %L)::text',
                pe.tp('Nomail', (s - interval '10 years')::date, ''), gen_random_uuid())) like 'ERR:%GUARDIAN_EMAIL_REQUIRED%',
                'third party: a guardian e-mail is required (verification)');
  r := pe.run(pe.get('BOOKER'), format('select public.third_party_participant_create(%L, %L)::text',
              pe.tp('Friendkid', (s - interval '10 years')::date, 'pe-guardian@example.test'), v_req_id));
  v_ath := (pe.j(r)->>'athlete_id')::uuid; v_req := (pe.j(r)->>'consent_request_id')::uuid;
  perform pe.ok(pe.j(r)->>'kind' = 'other' and pe.j(r)->>'status' = 'awaiting_consent' and v_ath is not null and v_req is not null,
                'third party: participant created, awaiting consent (' || r || ')');
  r2 := pe.run(pe.get('BOOKER'), format('select public.third_party_participant_create(%L, %L)::text',
              pe.tp('Friendkid', (s - interval '10 years')::date, 'pe-guardian@example.test'), v_req_id));
  perform pe.ok((pe.j(r2)->>'athlete_id')::uuid = v_ath and pe.j(r2)->>'replayed' = 'true', 'third party: request id replay returns the same participant');
  select family_id into v_fam from public.athletes where id = v_ath;
  perform pe.ok((select membership_status from public.families where id = v_fam) = 'guest'
                and not exists (select 1 from public.family_members where family_id = v_fam),
                'third party: holding guest family with no members');
  perform pe.ok(not exists (select 1 from public.family_members fm join public.athletes a on a.family_id = fm.family_id
                             where a.id = v_ath and fm.profile_id = pe.get('BOOKER')), 'third party: the booker is not in the child''s family');
  perform pe.ok(pe.run(pe.get('BOOKER'), format('select public.is_guardian_of_athlete(%L)::text', v_ath)) = 'OK:false',
                'third party: is_guardian_of_athlete is false for the booker');
  perform pe.ok(pe.run(pe.get('BOOKER'), format('select count(*)::text from public.athletes where id = %L', v_ath)) = 'OK:0'
                and pe.run(pe.get('BOOKER'), format('select count(*)::text from public.athlete_medical where athlete_id = %L', v_ath)) = 'OK:0',
                'third party: the booker cannot read the athlete row or medical data');
  perform pe.ok(pe.run(pe.get('BOOKER'), 'select count(*)::text from public.guardian_consent_requests') = 'OK:0'
                and pe.run(pe.get('BOOKER'), 'select count(*)::text from public.participant_bookers') = 'OK:1',
                'third party: the booker reads only their booker row, never the consent request table');

  -- Hold W1 (capacity 1).
  r := pe.run(pe.get('BOOKER'), format('select public.third_party_camp_hold(%L, %L)::text',
              pe.hold(v_ath, '00000000-0000-0000-0000-0000000ee0e1', 'synthetic-token-one-0123456789abcdef0123456789'), gen_random_uuid()));
  v_reg := (pe.j(r)->>'registration_id')::uuid;
  perform pe.ok(v_reg is not null and pe.j(r)->>'status' = 'awaiting_consent', 'camp hold: place held (' || r || ')');
  perform pe.ok((select status::text || '/' || guardian_consent_status || '/' || coalesce(invoice_id::text, 'no-invoice') || '/' || registered_by::text
                   from public.registrations where id = v_reg) = 'pending/awaiting/no-invoice/' || pe.txt('BOOKER'),
                'camp hold: pending (holds capacity), awaiting consent, no invoice, registered_by = booker');
  perform pe.ok((select token_hash from public.guardian_consent_requests where id = v_req) = pe.hash('synthetic-token-one-0123456789abcdef0123456789')
                and not exists (select 1 from public.guardian_consent_requests r0
                                 where to_jsonb(r0)::text like '%synthetic-token-one%'),
                'consent request: only the token hash is stored');
  perform pe.ok((select expires_at from public.guardian_consent_requests where id = v_req) between now() + interval '71 hours' and now() + interval '73 hours',
                'consent request: hold expires after 72 h');
  perform pe.ok(pe.run(pe.get('ADMIN'), format($q$update public.registrations set status = 'confirmed' where id = %L returning 'x'$q$, v_reg)) like 'ERR:%CONSENT_PENDING%',
                'guard: staff cannot confirm a registration awaiting consent');
  perform pe.ok(pe.run(pe.get('ADMIN'), format($q$update public.registrations set guardian_consent_status = 'accepted' where id = %L returning 'x'$q$, v_reg)) like 'ERR:%CONSENT_LOCKED%',
                'guard: the consent state changes only through the consent RPCs');

  -- Booker status: whitelisted fields only.
  r := pe.run(pe.get('BOOKER'), 'select public.booker_booking_status()::text');
  row := pe.j(r)->0;
  perform pe.ok(row->>'consent' = 'awaiting' and row->>'participant_name' = 'Friendkid Thirdparty' and row->>'activity' = 'Synthetic Consent Camp',
                'booker status: awaiting consent shown (' || coalesce(row::text, r) || ')');
  select array_agg(k order by k) into v_keys from jsonb_object_keys(row) k;
  perform pe.ok(v_keys = array['activity','camp_approval','consent','consent_expires_at','consent_request_id','edition','ends_at','ends_on',
                               'invoice','item_id','kind','participant_name','sort','starts_at','starts_on','status'],
                'booker status: whitelisted keys only (no DOB, medical, family or athlete id)');

  -- Consent page view (anon with the link).
  r := pe.run(null, format('select public.guardian_consent_view(%L)::text', pe.hash('synthetic-token-one-0123456789abcdef0123456789')), 'svc');
  perform pe.ok(pe.j(r)->>'found' = 'true' and pe.j(r)->>'email_hint' = 'p***@example.test' and pe.j(r)->>'booker_name' = 'Synthetic Booker'
                and jsonb_array_length(pe.j(r)->'items') = 1 and not (pe.j(r)->'participant' ? 'dob'),
                'consent view: activity, booker, masked e-mail; no DOB');
  perform pe.ok(pe.j(pe.run(null, format('select public.guardian_consent_view(%L)::text', pe.hash('wrong-token')), 'svc'))->>'found' = 'false',
                'consent view: unknown token finds nothing');
  perform pe.ok(pe.run(null, format('select public.guardian_consent_view(%L)::text', pe.hash('synthetic-token-one-0123456789abcdef0123456789'))) like 'ERR:%'
                and pe.run(null, format('select public.guardian_consent_decline(%L)::text', pe.hash('synthetic-token-one-0123456789abcdef0123456789'))) like 'ERR:%',
                'consent view / decline: no direct anon EXECUTE (the server calls them after hashing the link token)');

  -- Accept: wrong e-mail, booker, anon, missing required form refused.
  perform pe.ok(pe.run(pe.get('WRONG'), format('select public.guardian_consent_accept(%L, %L)::text',
                pe.hash('synthetic-token-one-0123456789abcdef0123456789'), pe.keys(v_req))) like 'ERR:%EMAIL_MISMATCH%',
                'accept: a different signed-in e-mail is refused');
  perform pe.ok(pe.run(pe.get('BOOKER'), format('select public.guardian_consent_accept(%L, %L)::text',
                pe.hash('synthetic-token-one-0123456789abcdef0123456789'), pe.keys(v_req))) like 'ERR:%BOOKER_CANNOT_CONSENT%',
                'accept: the booker cannot consent');
  perform pe.ok(pe.run(null, format('select public.guardian_consent_accept(%L, %L)::text',
                pe.hash('synthetic-token-one-0123456789abcdef0123456789'), pe.keys(v_req))) like 'ERR:%',
                'accept: anon refused (sign-in required)');
  perform pe.ok(pe.run(pe.get('GUARD'), format('select public.guardian_consent_accept(%L, %L)::text',
                pe.hash('synthetic-token-one-0123456789abcdef0123456789'), '{"accepted_keys":["pe_media"]}')) like 'ERR:%CONSENT_REQUIRED%',
                'accept: every required form must be accepted');
  update auth.users set email_confirmed_at = null where id = pe.get('GUARD');
  perform pe.ok(pe.run(pe.get('GUARD'), format('select public.guardian_consent_accept(%L, %L)::text',
                pe.hash('synthetic-token-one-0123456789abcdef0123456789'), pe.keys(v_req))) like 'ERR:%EMAIL_MISMATCH%',
                'accept: an unconfirmed sign-in e-mail is not proof of ownership');
  update auth.users set email_confirmed_at = now() where id = pe.get('GUARD');

  r := pe.run(pe.get('GUARD'), format('select public.guardian_consent_accept(%L, %L)::text',
              pe.hash('synthetic-token-one-0123456789abcdef0123456789'), pe.keys(v_req)));
  perform pe.ok(pe.j(r)->>'ok' = 'true' and pe.j(r)->>'status' = 'accepted', 'accept: guardian with the right e-mail accepts (' || r || ')');
  perform pe.ok(exists (select 1 from public.family_members where family_id = v_fam and profile_id = pe.get('GUARD') and is_primary and receives_emails),
                'accept: guardian added as primary guardian (receives e-mails)');
  perform pe.ok(pe.run(pe.get('GUARD'), format('select public.is_guardian_of_athlete(%L)::text', v_ath)) = 'OK:true'
                and pe.run(pe.get('GUARD'), format('select count(*)::text from public.athletes where id = %L', v_ath)) = 'OK:1',
                'accept: the guardian has profile access');
  perform pe.ok((select count(*) from public.consent_acceptances where athlete_id = v_ath and accepted_by = pe.get('GUARD'))
                = (select jsonb_array_length(consent_forms) from public.guardian_consent_requests where id = v_req),
                'accept: consent_acceptances recorded by the guardian');
  perform pe.ok((select status::text from public.registrations where id = v_reg) = 'pending'
                and (select i.payer_profile_id from public.invoices i join public.registrations g on g.invoice_id = i.id where g.id = v_reg) = pe.get('BOOKER')
                and (select i.payer_kind from public.invoices i join public.registrations g on g.invoice_id = i.id where g.id = v_reg) = 'other',
                'accept: the camp booking proceeds (pending + invoice to the booker as payer)');
  r2 := pe.run(pe.get('GUARD'), format('select public.guardian_consent_accept(%L, %L)::text',
               pe.hash('synthetic-token-one-0123456789abcdef0123456789'), pe.keys(v_req)));
  perform pe.ok(pe.j(r2)->>'replayed' = 'true', 'accept: a second click replays');
  row := pe.j(pe.run(pe.get('BOOKER'), 'select public.booker_booking_status()::text'))->0;
  perform pe.ok(row->>'consent' = 'accepted' and (row->'invoice'->>'balance')::numeric = 300, 'booker status: awaiting payment with the amount due');
  -- The booker pays: still no access.
  update public.invoices set status = 'paid' where id = (select invoice_id from public.registrations where id = v_reg);
  perform pe.ok((select status::text from public.registrations where id = v_reg) = 'confirmed', 'payment: the consented registration is confirmed when paid');
  perform pe.ok(pe.run(pe.get('BOOKER'), format('select public.is_guardian_of_athlete(%L)::text', v_ath)) = 'OK:false'
                and pe.run(pe.get('BOOKER'), format('select count(*)::text from public.athletes where id = %L', v_ath)) = 'OK:0'
                and pe.run(pe.get('BOOKER'), format('select count(*)::text from public.consent_acceptances where athlete_id = %L', v_ath)) = 'OK:0',
                'payment: paying grants the booker no profile access');
  perform pe.put('ATH1', v_ath::text);
end $$;

-- ===========================================================================
-- 4. Decline frees the place
-- ===========================================================================
do $$
declare r text; v_ath uuid; v_ath2 uuid; v_reg uuid; s date := pe.txt('start')::date;
begin
  r := pe.run(pe.get('BOOKER'), format('select public.third_party_participant_create(%L, %L)::text',
              pe.tp('Declinekid', (s - interval '9 years')::date, 'pe-guardian-two@example.test'), gen_random_uuid()));
  v_ath := (pe.j(r)->>'athlete_id')::uuid;
  r := pe.run(pe.get('BOOKER'), format('select public.third_party_participant_create(%L, %L)::text',
              pe.tp('Waitkid', (s - interval '9 years')::date, 'pe-guardian-two@example.test'), gen_random_uuid()));
  v_ath2 := (pe.j(r)->>'athlete_id')::uuid;
  r := pe.run(pe.get('BOOKER'), format('select public.third_party_camp_hold(%L, %L)::text',
              pe.hold(v_ath, '00000000-0000-0000-0000-0000000ee0e2', 'synthetic-token-two-0123456789abcdef0123456789'), gen_random_uuid()));
  v_reg := (pe.j(r)->>'registration_id')::uuid;
  perform pe.ok(pe.run(pe.get('BOOKER'), format('select public.third_party_camp_hold(%L, %L)::text',
                pe.hold(v_ath2, '00000000-0000-0000-0000-0000000ee0e2', 'synthetic-token-wait-0123456789abcdef012345678'), gen_random_uuid())) like 'ERR:%EDITION_FULL%',
                'hold: the held place counts toward capacity (week full)');
  r := pe.run(null, format('select public.guardian_consent_decline(%L)::text', pe.hash('synthetic-token-two-0123456789abcdef0123456789')), 'svc');
  perform pe.ok(pe.j(r)->>'status' = 'declined', 'decline: the link holder declines without an account (' || r || ')');
  perform pe.ok((select status::text || '/' || guardian_consent_status from public.registrations where id = v_reg) = 'cancelled/declined',
                'decline: the held registration is cancelled');
  perform pe.ok(pe.run(pe.get('BOOKER'), format('select public.third_party_camp_hold(%L, %L)::text',
                pe.hold(v_ath2, '00000000-0000-0000-0000-0000000ee0e2', 'synthetic-token-wait-0123456789abcdef012345678'), gen_random_uuid())) like 'OK:%',
                'decline: the place is free again');
  perform pe.ok(exists (select 1 from public.guardian_consent_requests where athlete_id = v_ath and status = 'declined' and outcome_notified_at is null),
                'decline: the outcome is queued for the booker notice');
end $$;

-- ===========================================================================
-- 5. Expiry after the hold frees the place (job + lazy)
-- ===========================================================================
do $$
declare r text; v_ath uuid; v_reg uuid; v_req uuid; s date := pe.txt('start')::date; n int;
begin
  r := pe.run(pe.get('BOOKER'), format('select public.third_party_participant_create(%L, %L)::text',
              pe.tp('Expirekid', (s - interval '9 years')::date, 'pe-guardian-two@example.test'), gen_random_uuid()));
  v_ath := (pe.j(r)->>'athlete_id')::uuid; v_req := (pe.j(r)->>'consent_request_id')::uuid;
  r := pe.run(pe.get('BOOKER'), format('select public.third_party_camp_hold(%L, %L)::text',
              pe.hold(v_ath, '00000000-0000-0000-0000-0000000ee0e3', 'synthetic-token-exp-0123456789abcdef01234567890'), gen_random_uuid()));
  v_reg := (pe.j(r)->>'registration_id')::uuid;
  update public.guardian_consent_requests set expires_at = now() - interval '1 minute' where id = v_req;
  perform pe.ok(pe.run(pe.get('BOOKER'), 'select public.guardian_consent_expire()::text') like 'ERR:%', 'expiry job: service role only');
  r := pe.run(null, 'select public.guardian_consent_expire()::text', 'svc');
  perform pe.ok((pe.j(r)->>'expired')::int >= 1 and exists (select 1 from jsonb_array_elements(pe.j(r)->'to_notify') x where (x->>'id')::uuid = v_req),
                'expiry job: the request expires and is listed for notification (' || r || ')');
  perform pe.ok((select status::text || '/' || guardian_consent_status from public.registrations where id = v_reg) = 'cancelled/expired',
                'expiry: the held registration is cancelled (place freed)');
  perform pe.ok(pe.run(pe.get('GUARD2'), format('select public.guardian_consent_accept(%L, %L)::text',
                pe.hash('synthetic-token-exp-0123456789abcdef01234567890'), pe.keys(v_req))) like 'ERR:%EXPIRED%',
                'expiry: an expired link cannot be accepted');
  -- Lazy expiry on the booker's read.
  r := pe.run(pe.get('BOOKER'), format('select public.third_party_camp_hold(%L, %L)::text',
              pe.hold(v_ath, '00000000-0000-0000-0000-0000000ee0e3', 'synthetic-token-lazy-0123456789abcdef0123456789'), gen_random_uuid()));
  v_reg := (pe.j(r)->>'registration_id')::uuid;
  perform pe.ok(v_reg is not null, 'expiry: the freed week can be held again (new consent request)');
  update public.guardian_consent_requests set expires_at = now() - interval '1 minute'
   where athlete_id = v_ath and status = 'pending';
  r := pe.run(pe.get('BOOKER'), 'select public.booker_booking_status()::text');
  perform pe.ok(exists (select 1 from jsonb_array_elements(pe.j(r)) x where (x->>'item_id')::uuid = v_reg and x->>'consent' = 'expired' and x->>'status' = 'cancelled'),
                'expiry: lazy expiry on the booker''s read');
end $$;

-- ===========================================================================
-- 6. Camp age rules for third-party bookings (first day of the week)
-- ===========================================================================
do $$
declare r text; v_ath uuid; v_req uuid; v_reg uuid; s date := pe.txt('start')::date;
begin
  r := pe.run(pe.get('BOOKER'), format('select public.third_party_participant_create(%L, %L)::text',
              pe.tp('Sevenkid', (s + 21 - interval '7 years 3 months')::date, 'pe-guardian@example.test'), gen_random_uuid()));
  v_ath := (pe.j(r)->>'athlete_id')::uuid; v_req := (pe.j(r)->>'consent_request_id')::uuid;
  r := pe.run(pe.get('BOOKER'), format('select public.third_party_camp_hold(%L, %L)::text',
              pe.hold(v_ath, '00000000-0000-0000-0000-0000000ee0e4', 'synthetic-token-seven-0123456789abcdef012345678'), gen_random_uuid()));
  v_reg := (pe.j(r)->>'registration_id')::uuid;
  perform pe.ok(pe.j(r)->>'age_band' = 'approval' and (select status::text from public.registrations where id = v_reg) = 'pending',
                'age: a 7-year-old is held awaiting consent first (' || r || ')');
  r := pe.run(pe.get('GUARD'), format('select public.guardian_consent_accept(%L, %L)::text',
              pe.hash('synthetic-token-seven-0123456789abcdef012345678'), pe.keys(v_req)));
  perform pe.ok((select status::text || '/' || approval_status || '/' || guardian_consent_status from public.registrations where id = v_reg)
                = 'pending_approval/pending/accepted', 'age: after consent the 7-year-old goes to camp age approval (' || r || ')');
  -- The admin approves -> invoice to the booker.
  r := pe.run(pe.get('ADMIN'), format($q$select public.camp_approval_decide(%L, 'approve')::text$q$, v_reg));
  perform pe.ok((select i.payer_profile_id from public.invoices i join public.registrations g on g.invoice_id = i.id where g.id = v_reg) = pe.get('BOOKER'),
                'age: the approved registration is invoiced to the booker (' || r || ')');
  r := pe.run(pe.get('BOOKER'), format('select public.third_party_participant_create(%L, %L)::text',
              pe.tp('Fivekid', (s + 21 - interval '5 years 3 months')::date, 'pe-guardian@example.test'), gen_random_uuid()));
  v_ath := (pe.j(r)->>'athlete_id')::uuid;
  perform pe.ok(pe.run(pe.get('BOOKER'), format('select public.third_party_camp_hold(%L, %L)::text',
                pe.hold(v_ath, '00000000-0000-0000-0000-0000000ee0e4', 'synthetic-token-five-0123456789abcdef0123456789'), gen_random_uuid())) like 'ERR:%AGE_OUT_OF_RANGE%',
                'age: under 6 on the first day is refused');
end $$;

-- ===========================================================================
-- 7. Training request held until consent
-- ===========================================================================
insert into public.app_settings (org_id) values ('00000000-0000-0000-0000-000000000001') on conflict (org_id) do nothing;
update public.app_settings set settings = coalesce(settings, '{}'::jsonb) || '{"bookings_enabled": true}'::jsonb
 where org_id = '00000000-0000-0000-0000-000000000001';
insert into public.venues (id, org_id, name, opening_hours) values
  ('00000000-0000-0000-0000-0000000ee0b1', '00000000-0000-0000-0000-000000000001', 'PE Hall',
   jsonb_build_object('1', '[["00:00","23:59"]]'::jsonb, '2', '[["00:00","23:59"]]'::jsonb, '3', '[["00:00","23:59"]]'::jsonb,
                      '4', '[["00:00","23:59"]]'::jsonb, '5', '[["00:00","23:59"]]'::jsonb, '6', '[["00:00","23:59"]]'::jsonb,
                      '7', '[["00:00","23:59"]]'::jsonb));
insert into public.training_services (id, org_id, slug, name, duration_min, price_chf, kind, session_type, max_participants, currency, venue_id, bookable_by_families) values
  ('00000000-0000-0000-0000-0000000ee0d1', '00000000-0000-0000-0000-000000000001', 'pe-pt', 'PE Private', 60, 80, 'private', 'individual', 1, 'CHF', '00000000-0000-0000-0000-0000000ee0b1', true);
insert into public.training_service_coaches (org_id, service_id, coach_id) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ee0d1', '00000000-0000-0000-0000-000000000011');
do $$
declare r text; v_bid uuid; v_req uuid; v_payload jsonb;
begin
  v_payload := jsonb_build_object('athlete_id', pe.get('ATH1'), 'service_id', '00000000-0000-0000-0000-0000000ee0d1',
                                  'coach_id', '00000000-0000-0000-0000-000000000011',
                                  'starts_at', (date_trunc('day', now()) + interval '12 days 12 hours'),
                                  'token_hash', pe.hash('synthetic-token-training-0123456789abcdef0123456'));
  -- The child's own family holds a package for this service: never used by the booker.
  insert into public.training_package_purchases (id, org_id, athlete_id, family_id, service_id, sessions, list_price, amount, currency,
                                                 payment_mode, status, granted_at)
  select '00000000-0000-0000-0000-0000000ee0f9', a.org_id, a.id, a.family_id, '00000000-0000-0000-0000-0000000ee0d1', 2, 160, 160, 'CHF',
         'comp', 'active', now()
    from public.athletes a where a.id = pe.get('ATH1');
  r := pe.run(pe.get('BOOKER'), format('select public.third_party_training_quote(%L)::text', v_payload));
  perform pe.ok(pe.j(r)->>'ok' = 'true' and pe.j(r)->'billing'->>'billing_mode' = 'invoice' and (pe.j(r)->'billing'->>'price')::numeric = 80,
                'training: the booker gets an invoice quote, never the child''s family package (' || r || ')');
  r := pe.run(pe.get('BOOKER'), format('select public.third_party_training_catalog(%L)::text', pe.get('ATH1')));
  perform pe.ok(pe.j(r)->'athlete'->>'first_name' = 'Friendkid Thirdparty' and pe.j(r)->'athlete'->>'last_name' = ''
                and jsonb_array_length(pe.j(r)->'services') >= 1,
                'training: the booker''s catalog shows only the typed name (' || left(r, 200) || ')');
  perform pe.ok(pe.run(pe.get('BOOKER'), format('select public.family_booking_catalog(%L)::text', pe.get('ATH1'))) like 'ERR:%ATHLETE_NOT_FOUND%',
                'training: the family catalog stays closed to the booker');
  perform pe.ok(pe.run(pe.get('WRONG'), format('select public.third_party_training_catalog(%L)::text', pe.get('ATH1'))) like 'ERR:%',
                'training: another user cannot read the booker''s catalog');
  perform pe.ok(pe.run(pe.get('BOOKER'), format('select public.booking_family_request(%L, %L)::text', v_payload, gen_random_uuid())) like 'ERR:%ATHLETE_NOT_FOUND%',
                'training: the family path stays closed to the booker');
  r := pe.run(pe.get('BOOKER'), format('select public.third_party_training_request(%L, %L)::text', v_payload, gen_random_uuid()));
  v_bid := (pe.j(r)->>'booking_id')::uuid; v_req := (pe.j(r)->>'consent_request_id')::uuid;
  perform pe.ok(v_bid is not null and (select status::text || '/' || guardian_consent_status from public.training_bookings where id = v_bid) = 'requested/awaiting'
                and v_req is distinct from (select id from public.guardian_consent_requests where athlete_id = pe.get('ATH1') and status = 'accepted' limit 1),
                'training: requested + awaiting consent, a new consent request (' || r || ')');
  perform pe.ok((select p.profile_id from public.training_bookings b join public.billing_payers p on p.id = b.payer_id where b.id = v_bid) = pe.get('BOOKER'),
                'training: the booker is the payer (billing_payers kind other)');
  perform pe.ok((select billing_mode from public.training_bookings where id = v_bid) = 'invoice'
                and (select sessions_used from public.training_package_purchases where id = '00000000-0000-0000-0000-0000000ee0f9') = 0,
                'training: billed by invoice to the booker; the family package is untouched');
  perform pe.ok(pe.run(pe.get('ADMIN'), format('select public.booking_request_confirm(%L, %L)::text', v_bid, gen_random_uuid())) like 'ERR:%CONSENT_PENDING%',
                'training: staff cannot confirm before the guardian consents');
  r := pe.run(pe.get('GUARD'), format('select public.guardian_consent_accept(%L, %L)::text',
              pe.hash('synthetic-token-training-0123456789abcdef0123456'), pe.keys(v_req)));
  perform pe.ok((select guardian_consent_status from public.training_bookings where id = v_bid) = 'accepted'
                and (select status::text from public.training_bookings where id = v_bid) = 'requested',
                'training: after consent the request waits for the coach (existing rule)');
  perform pe.ok(pe.run(pe.get('ADMIN'), format('select public.booking_request_confirm(%L, %L)::text', v_bid, gen_random_uuid())) not like '%CONSENT_PENDING%',
                'training: staff may decide once consented');
end $$;

-- ===========================================================================
-- 8. Existing child: no duplicate, the request goes to its guardians
-- ===========================================================================
do $$
declare r text; v_ath uuid; v_req uuid; n_before int; n_after int; v jsonb;
begin
  select count(*) into n_before from public.athletes;
  r := pe.run(pe.get('BOOKER'), format('select public.third_party_participant_create(%L, %L)::text',
              jsonb_build_object('first_name', 'MATEO', 'last_name', 'lopes', 'dob', '2016-03-14', 'gender', 'male',
                                 'guardian_name', 'Synthetic Typed', 'guardian_email', 'pe-guardian@example.test', 'relation', 'friends_child'),
              gen_random_uuid()));
  select count(*) into n_after from public.athletes;
  v_ath := (pe.j(r)->>'athlete_id')::uuid; v_req := (pe.j(r)->>'consent_request_id')::uuid;
  perform pe.ok(pe.j(r)->>'kind' = 'other' and pe.j(r)->>'status' = 'awaiting_consent' and not (pe.j(r) ? 'existing_child')
                and n_before = n_after, 'existing child: same answer shape, no duplicate athlete');
  perform pe.ok(v_ath = pe.get('MATEO') and pe.run(pe.get('BOOKER'), format('select count(*)::text from public.athletes where id = %L', v_ath)) = 'OK:0',
                'existing child: the booker cannot read the existing record');
  r := pe.run(pe.get('BOOKER'), format('select public.third_party_camp_hold(%L, %L)::text',
              pe.hold(v_ath, '00000000-0000-0000-0000-0000000ee0e4', 'synthetic-token-mateo-0123456789abcdef012345678'), gen_random_uuid()));
  v := pe.j(pe.run(null, format('select public.guardian_consent_view(%L)::text', pe.hash('synthetic-token-mateo-0123456789abcdef012345678')), 'svc'));
  perform pe.ok(v->>'verification' = 'family' and v->>'email_hint' is null, 'existing child: verified by the existing guardians (' || coalesce(v::text, r) || ')');
  perform pe.ok(pe.run(pe.get('GUARD'), format('select public.guardian_consent_accept(%L, %L)::text',
                pe.hash('synthetic-token-mateo-0123456789abcdef012345678'), pe.keys(v_req))) like 'ERR:%NOT_GUARDIAN%',
                'existing child: the typed e-mail alone cannot accept');
  r := pe.run(pe.get('CARLA'), format('select public.guardian_consent_accept(%L, %L)::text',
              pe.hash('synthetic-token-mateo-0123456789abcdef012345678'), pe.keys(v_req)));
  perform pe.ok(pe.j(r)->>'status' = 'accepted'
                and (select count(*) from public.family_members where family_id = '00000000-0000-0000-0000-000000000061') = 1,
                'existing child: the existing guardian accepts; no new guardian added (' || r || ')');
end $$;

-- ===========================================================================
-- 9. Cross-tenant denial
-- ===========================================================================
do $$
begin
  perform pe.ok(pe.run(pe.get('BA'), 'select count(*)::text from public.guardian_consent_requests') = 'OK:0'
                and pe.run(pe.get('BA'), 'select count(*)::text from public.participant_bookers') = 'OK:0',
                'cross-tenant: org B admin reads no request / booker rows of org A');
  perform pe.ok(pe.run(pe.get('ADMIN'), 'select (count(*) > 0)::text from public.guardian_consent_requests') = 'OK:true'
                and pe.run(pe.get('ADMIN'), 'select (count(*) > 0)::text from public.participant_bookers') = 'OK:true',
                'same tenant: org A admin reads them');
  perform pe.ok(pe.run(pe.get('BA'), format('select public.third_party_camp_hold(%L, %L)::text',
                pe.hold(pe.get('ATH1'), '00000000-0000-0000-0000-0000000ee0e4', 'synthetic-token-cross-0123456789abcdef012345678'), gen_random_uuid())) like 'ERR:%ATHLETE_NOT_FOUND%',
                'cross-tenant: org B cannot hold a place for an org A participant');
  perform pe.ok(pe.run(pe.get('BA'), format('select public.third_party_training_quote(%L)::text',
                jsonb_build_object('athlete_id', pe.get('ATH1'), 'service_id', '00000000-0000-0000-0000-0000000ee0d1'))) like 'ERR:%ATHLETE_NOT_FOUND%',
                'cross-tenant: org B cannot quote training for an org A participant');
  perform pe.ok(pe.run(pe.get('BA'), 'select public.booker_booking_status()::text') = 'OK:[]'
                and pe.run(pe.get('BA'), 'select public.booker_participants()::text') = 'OK:[]',
                'cross-tenant: org B sees no booker rows');
  perform pe.ok(pe.run(pe.get('BA'), format('select public.guardian_consent_revoke(%L)::text',
                (select id from public.guardian_consent_requests limit 1))) like 'ERR:%NOT_FOUND%',
                'cross-tenant: org B cannot revoke an org A request');
  perform pe.ok(pe.run(pe.get('BA'), format($q$insert into public.participant_bookers (org_id, athlete_id, profile_id, display_name)
                values (%L, %L, %L, 'x') returning 'x'$q$, pe.get('ORGA'), pe.get('ATH1'), pe.get('BA'))) like 'ERR:%',
                'cross-tenant: no direct insert into participant_bookers');
  perform pe.ok(pe.run(null, format('select public.third_party_participant_create(%L, %L)::text',
                pe.tp('Anonkid', current_date - 3000, 'x@example.test'), gen_random_uuid())) like 'ERR:%',
                'anon: cannot create a third-party participant');
  perform pe.ok(pe.run(pe.get('BOOKER'), 'select public.public_entry_resolve_children(''{}''::jsonb)::text') like 'ERR:%',
                'service-only: public_entry_resolve_children refused to a signed-in user');
end $$;

\echo 'public_entry_consent suite done'
