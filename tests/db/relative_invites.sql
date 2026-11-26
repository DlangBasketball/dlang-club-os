-- ============================================================================
-- Relatives for one child: invitations, carer consent, club messages
-- (migration 20250420106500_relative_invites_carer_consent.sql)
--
--   A. Invitations: who may invite, validation, re-send, cap, rate limit,
--      view, RLS (token hash never readable), e-mail match on accept, the
--      invitee gets that child only, single use, expiry, revoke, cross-tenant.
--   B. Carer consent: setting OFF (request to the guardian, as today) vs ON
--      with can_consent (linker consents, no request) vs ON without
--      can_consent; health declaration needs can_see_medical; turning the
--      setting OFF after a grant gives no consent power.
--   C. Message audience: linkers of the child only (never siblings), dedup
--      with the family, opt-out (receives_emails) respected; team alerts and
--      training booking notices.
--
-- Fixtures: org A …0001 (seed.sql; admin …f1; consent forms media, transport,
-- health, terms, liability — all required). Org B 10000000-…0002.
-- SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema ri;
grant usage on schema ri to authenticated, anon, service_role;
create table ri.ctx (k text primary key, v text);
grant all on ri.ctx to authenticated, anon, service_role;

create function ri.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function ri.put(p_k text, p_v text) returns void language sql as $$
  insert into ri.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function ri.get(p_k text) returns uuid language sql stable as $$ select v::uuid from ri.ctx where k = p_k $$;
create function ri.txt(p_k text) returns text language sql stable as $$ select v from ri.ctx where k = p_k $$;
create function ri.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
create function ri.as_(p_who text, p_sql text) returns text language sql as $$ select ri.run_as(ri.get(p_who), p_sql) $$;
create function ri.j(p_res text) returns jsonb language sql immutable as $$
  select case when p_res like 'OK:%' and p_res <> 'OK:<null>' then substr(p_res, 4)::jsonb end
$$;
create function ri.hash(p_token text) returns text language sql immutable as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;
-- Invite as p_who for an athlete; returns the raw result.
create function ri.invite(p_who text, p_athlete text, p_payload jsonb, p_token text) returns text language sql as $$
  select ri.as_(p_who, format('select public.athlete_link_invite_create(%L, %L, %L, %L)::text',
                              ri.get(p_athlete), p_payload, ri.hash(p_token), gen_random_uuid()))
$$;
create function ri.set_carer(p_on boolean) returns void language sql as $$
  insert into public.app_settings (org_id, settings)
  values ('00000000-0000-0000-0000-000000000001', jsonb_build_object('privacy', jsonb_build_object('carers_may_consent', p_on)))
  on conflict (org_id) do update
     set settings = jsonb_set(coalesce(public.app_settings.settings, '{}'::jsonb), '{privacy}',
                              coalesce(public.app_settings.settings->'privacy', '{}'::jsonb) || jsonb_build_object('carers_may_consent', p_on));
$$;
grant execute on all functions in schema ri to authenticated, anon, service_role;

-- Fixtures -----------------------------------------------------------------------
-- G    primary guardian of family F (K1, sibling K2)
-- G2   second guardian of F (not primary)
-- G3   guardian of family F3 (K3) — unrelated parent
-- REL  relative invited by e-mail (ri-rel@example.test)
-- REL2 second relative (ri-rel2@example.test), approved without can_consent
-- WR   a login with another e-mail
-- OUT  outsider login, no family
-- BA   admin of org B; BK child of org B
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-00000000e901', 'ri-guardian@example.test', now()),
  ('00000000-0000-0000-0000-00000000e902', 'ri-guardian-two@example.test', now()),
  ('00000000-0000-0000-0000-00000000e903', 'ri-guardian-three@example.test', now()),
  ('00000000-0000-0000-0000-00000000e904', 'ri-rel@example.test', now()),
  ('00000000-0000-0000-0000-00000000e905', 'ri-rel2@example.test', now()),
  ('00000000-0000-0000-0000-00000000e906', 'ri-wrong@example.test', now()),
  ('00000000-0000-0000-0000-00000000e907', 'ri-outsider@example.test', now()),
  ('00000000-0000-0000-0000-00000000e908', 'ri-unconfirmed@example.test', null),
  ('b0000000-0000-0000-0000-00000000e90f', 'ri-admin-b@example.test', now());
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic ' || split_part(email::text, '@', 1)
 where id::text like '00000000-0000-0000-0000-00000000e90%';
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-00000000e90f';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000e90f', 'admin');

insert into public.families (id, org_id, name, contact_email) values
  ('00000000-0000-0000-0000-00000000e961', '00000000-0000-0000-0000-000000000001', 'Synthetic RI Family', 'ri-guardian@example.test'),
  ('00000000-0000-0000-0000-00000000e963', '00000000-0000-0000-0000-000000000001', 'Synthetic RI Family Three', 'ri-guardian-three@example.test');
insert into public.family_members (family_id, profile_id, relation, is_primary, can_pay, can_see_medical, receives_emails) values
  ('00000000-0000-0000-0000-00000000e961', '00000000-0000-0000-0000-00000000e901', 'mother', true, true, true, true),
  ('00000000-0000-0000-0000-00000000e961', '00000000-0000-0000-0000-00000000e902', 'father', false, true, true, true),
  ('00000000-0000-0000-0000-00000000e963', '00000000-0000-0000-0000-00000000e903', 'father', true, true, true, true);
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, gender, status) values
  ('00000000-0000-0000-0000-00000000e971', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000e961', 'Synthkid', 'Rione', current_date - interval '11 years', 'male', 'active'),
  ('00000000-0000-0000-0000-00000000e972', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000e961', 'Synthsib', 'Rione', current_date - interval '9 years', 'female', 'active'),
  ('00000000-0000-0000-0000-00000000e973', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000e963', 'Synthother', 'Rithree', current_date - interval '10 years', 'male', 'active');
insert into public.families (id, org_id, name) values ('b0000000-0000-0000-0000-00000000e961', '10000000-0000-0000-0000-000000000002', 'Synthetic RI B');
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, gender, status) values
  ('b0000000-0000-0000-0000-00000000e971', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000e961', 'Synthb', 'Rib', '2014-01-01', 'male', 'active');

select ri.put('G', '00000000-0000-0000-0000-00000000e901');
select ri.put('G2', '00000000-0000-0000-0000-00000000e902');
select ri.put('G3', '00000000-0000-0000-0000-00000000e903');
select ri.put('REL', '00000000-0000-0000-0000-00000000e904');
select ri.put('REL2', '00000000-0000-0000-0000-00000000e905');
select ri.put('WR', '00000000-0000-0000-0000-00000000e906');
select ri.put('OUT', '00000000-0000-0000-0000-00000000e907');
select ri.put('UNC', '00000000-0000-0000-0000-00000000e908');
select ri.put('BA', 'b0000000-0000-0000-0000-00000000e90f');
select ri.put('ADMIN', '00000000-0000-0000-0000-0000000000f1');
select ri.put('K1', '00000000-0000-0000-0000-00000000e971');
select ri.put('K2', '00000000-0000-0000-0000-00000000e972');
select ri.put('K3', '00000000-0000-0000-0000-00000000e973');
select ri.put('BK', 'b0000000-0000-0000-0000-00000000e971');
select ri.put('start', (current_date + 30)::text);

-- A paid camp (8-14) with three open weeks.
do $$
declare s date := ri.txt('start')::date;
begin
  insert into public.programs (id, org_id, slug, name, kind, price_chf, is_public, is_active, status, currency, min_age, max_age)
  values ('00000000-0000-0000-0000-00000000e941', '00000000-0000-0000-0000-000000000001', 'ri-camp', 'Synthetic Relative Camp',
          'camp', 0, true, true, 'published', 'CHF', 8, 14);
  insert into public.camp_editions (id, org_id, program_id, name, starts_on, ends_on, capacity, status) values
    ('00000000-0000-0000-0000-00000000e9e1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000e941', 'W1', s, s + 4, 9, 'published'),
    ('00000000-0000-0000-0000-00000000e9e2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000e941', 'W2', s + 7, s + 11, 9, 'published'),
    ('00000000-0000-0000-0000-00000000e9e3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000e941', 'W3', s + 14, s + 18, 9, 'published');
  insert into public.camp_age_groups (id, org_id, program_id, label, min_age, max_age) values
    ('00000000-0000-0000-0000-00000000e9a0', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000e941', '8-14', 8, 14);
  insert into public.camp_price_options (id, org_id, program_id, edition_id, label, days_count, includes_lunch, price) values
    ('00000000-0000-0000-0000-00000000e9c1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000e941', null, 'Full week', 5, true, 250);
end $$;
create function ri.hold(p_athlete uuid, p_edition uuid, p_token text) returns jsonb language sql stable as $$
  select jsonb_build_object('program_id', '00000000-0000-0000-0000-00000000e941', 'edition_id', p_edition,
                            'athlete_id', p_athlete, 'age_group_id', '00000000-0000-0000-0000-00000000e9a0',
                            'price_option_id', '00000000-0000-0000-0000-00000000e9c1',
                            'days', (select jsonb_agg(to_char(d, 'YYYY-MM-DD') order by d)
                                       from public.camp_editions e, generate_series(e.starts_on, e.ends_on, interval '1 day') d
                                      where e.id = p_edition),
                            'token_hash', ri.hash(p_token))
$$;
grant execute on all functions in schema ri to authenticated, anon, service_role;
select ri.set_carer(false);

-- ===========================================================================
-- A. Invitations
-- ===========================================================================
do $$
declare r text; v jsonb; v_id uuid; v_id2 uuid;
begin
  r := ri.invite('OUT', 'K1', '{"email":"ri-rel@example.test","relation":"aunt_uncle"}', 'tok-out');
  perform ri.ok(r like 'ERR:NOT_FOUND%', 'an outsider cannot invite (' || r || ')');
  r := ri.invite('G3', 'K1', '{"email":"ri-rel@example.test","relation":"aunt_uncle"}', 'tok-g3');
  perform ri.ok(r like 'ERR:NOT_FOUND%', 'a guardian of another family cannot invite for the child');
  r := ri.invite('BA', 'K1', '{"email":"ri-rel@example.test","relation":"aunt_uncle"}', 'tok-ba');
  perform ri.ok(r like 'ERR:NOT_FOUND%', 'cross-tenant: admin of org B cannot invite for an org A child');
  r := ri.invite('G', 'BK', '{"email":"ri-rel@example.test","relation":"aunt_uncle"}', 'tok-bk');
  perform ri.ok(r like 'ERR:NOT_FOUND%', 'cross-tenant: an org A guardian cannot invite for an org B child');
  r := ri.invite('G', 'K1', '{"email":"ri-off@example.test","relation":"aunt_uncle","can_consent":true}', 'tok-c');
  perform ri.ok(r like 'OK:%' and (select (permissions->>'can_consent')::boolean from public.athlete_link_invitations where email = 'ri-off@example.test') = false,
                'setting OFF: the invitation is created, can_consent stored as not granted (' || r || ')');
  delete from public.athlete_link_invitations where email = 'ri-off@example.test';
  r := ri.invite('G', 'K1', '{"email":"ri-rel@example.test","relation":"aunt_uncle","can_register":true,"can_pay":false}', 'tok-p');
  perform ri.ok(r like 'ERR:REGISTER_NEEDS_PAY%', 'booking without paying refused');
  r := ri.invite('G', 'K1', '{"email":"not-an-email","relation":"aunt_uncle"}', 'tok-e');
  perform ri.ok(r like 'ERR:INVALID_EMAIL%', 'invalid e-mail refused');
  r := ri.invite('G', 'K1', '{"email":"ri-rel@example.test","relation":"cousin"}', 'tok-r');
  perform ri.ok(r like 'ERR:INVALID_RELATION%', 'unknown relation refused');
  r := ri.invite('G', 'K1', '{"email":"RI-Guardian@example.test","relation":"aunt_uncle"}', 'tok-s');
  perform ri.ok(r like 'ERR:CANNOT_INVITE_SELF%', 'cannot invite oneself (case-insensitive)');
  r := ri.invite('G', 'K1', '{"email":"ri-guardian-two@example.test","relation":"aunt_uncle"}', 'tok-g2');
  perform ri.ok(r like 'ERR:ALREADY_GUARDIAN%', 'a guardian of the family is not invited as a relative');

  r := ri.invite('G', 'K1', '{"email":"ri-rel@example.test","relation":"aunt_uncle"}', 'tok-rel-1');
  v := ri.j(r);
  v_id := (v->>'invitation_id')::uuid;
  perform ri.ok(v->>'ok' = 'true' and v->>'resent' = 'false', 'the primary guardian invites a relative for one child (' || r || ')');
  perform ri.put('INV_REL', v_id::text);
  perform ri.ok((select status = 'pending' and relation = 'aunt_uncle' and email = 'ri-rel@example.test'
                        and expires_at between now() + interval '13 days' and now() + interval '15 days'
                        and token_hash = ri.hash('tok-rel-1') and invited_by = ri.get('G')
                        and (permissions->>'can_register')::boolean and (permissions->>'can_pay')::boolean
                        and (permissions->>'receives_emails')::boolean and not (permissions->>'can_see_medical')::boolean
                        and not (permissions->>'can_edit_profile')::boolean and not (permissions->>'can_consent')::boolean
                   from public.athlete_link_invitations where id = v_id),
                'invitation stored: pending, 14 days, hashed token, default permissions');
  perform ri.ok(exists (select 1 from public.audit_logs where target_id = v_id and action = 'participant.link.invite_created'
                          and not (new_data::text like '%ri-rel@example.test%')),
                'creation audited (masked e-mail only)');
  perform ri.ok(not exists (select 1 from public.audit_logs where target_id = v_id and new_data::text like '%' || ri.hash('tok-rel-1') || '%'),
                'token hash never written to the audit log');

  -- Re-send: same invitation, new token; the old link stops working.
  r := ri.invite('G', 'K1', '{"email":"ri-rel@example.test","relation":"aunt_uncle"}', 'tok-rel-2');
  v := ri.j(r);
  perform ri.ok((v->>'invitation_id')::uuid = v_id and v->>'resent' = 'true', 're-inviting the same e-mail re-sends (same row)');
  perform ri.ok(ri.as_('REL', format('select public.athlete_link_invite_view(%L)->>''found''', ri.hash('tok-rel-1'))) = 'OK:false',
                'the previous token is no longer valid');

  -- A second (non-primary) family guardian can invite too.
  r := ri.invite('G2', 'K1', '{"email":"ri-rel2@example.test","relation":"family_friend","can_see_medical":false}', 'tok-rel2');
  perform ri.ok(ri.j(r)->>'ok' = 'true', 'a non-primary family guardian may invite (' || r || ')');
  perform ri.put('INV_REL2', ri.j(r)->>'invitation_id');

  -- View (invitee, signed in): club, child FIRST name only, relation, inviter, permissions, masked e-mail.
  r := ri.as_('REL', format('select public.athlete_link_invite_view(%L)::text', ri.hash('tok-rel-2')));
  v := ri.j(r);
  perform ri.ok(v->>'found' = 'true' and v->>'child_first_name' = 'Synthkid' and v->>'relation' = 'aunt_uncle'
                and v->>'inviter_name' like 'Synthetic ri-guardian' and v->>'email_hint' = 'r***@example.test'
                and v->'club'->>'name' is not null, 'invitation page view (' || r || ')');
  perform ri.ok(position('Rione' in r) = 0 and position('dob' in r) = 0 and not (v->'permissions' ? 'can_consent'),
                'the view shows no last name, no DOB; consent permission hidden while the setting is OFF');
  perform ri.ok(ri.run_as(null, format('select public.athlete_link_invite_view(%L)::text', ri.hash('tok-rel-2'))) like 'ERR:%',
                'anon has no EXECUTE on the view (the server hashes the link and uses the service role)');

  -- RLS: inviter / family / admins read; the invitee, outsiders and other clubs do not; token hash never readable.
  perform ri.ok(ri.as_('G', format('select count(*)::text from public.athlete_link_invitations where athlete_id = %L', ri.get('K1'))) = 'OK:2',
                'family guardians read the child''s invitations');
  perform ri.ok(ri.as_('ADMIN', format('select count(*)::text from public.athlete_link_invitations where athlete_id = %L', ri.get('K1'))) = 'OK:2',
                'club admins read them');
  perform ri.ok(ri.as_('REL', 'select count(*)::text from public.athlete_link_invitations') = 'OK:0', 'the invitee cannot list invitations');
  perform ri.ok(ri.as_('G3', 'select count(*)::text from public.athlete_link_invitations') = 'OK:0', 'another family reads none');
  perform ri.ok(ri.as_('BA', 'select count(*)::text from public.athlete_link_invitations') = 'OK:0', 'cross-tenant: org B reads none');
  perform ri.ok(ri.as_('G', 'select count(token_hash)::text from public.athlete_link_invitations') like 'ERR:%permission%',
                'the token hash column is not readable through the API');
  perform ri.ok(ri.as_('G', format('insert into public.athlete_link_invitations (org_id, athlete_id, email, expires_at) values (%L, %L, ''x@example.test'', now()) returning 1',
                                   '00000000-0000-0000-0000-000000000001', ri.get('K1'))) like 'ERR:%',
                'no direct insert');
  perform ri.ok(ri.as_('G', format('update public.athlete_link_invitations set status = ''accepted'' where id = %L returning 1', v_id)) like 'ERR:%',
                'no direct update');
  perform ri.ok(ri.as_('ADMIN', format('delete from public.athlete_link_invitations where id = %L returning 1', v_id)) in ('OK:<null>')
                or ri.as_('ADMIN', format('delete from public.athlete_link_invitations where id = %L returning 1', v_id)) like 'ERR:%',
                'no direct delete');
  perform ri.ok(exists (select 1 from public.athlete_link_invitations where id = v_id), 'invitation still there after the delete attempt');

  -- Lists.
  perform ri.ok(jsonb_array_length(ri.j(ri.as_('G', format('select public.athlete_link_invites_for(%L)::text', ri.get('K1'))))) = 2,
                'athlete_link_invites_for: the family sees both');
  perform ri.ok(ri.j(ri.as_('G', 'select public.athlete_link_invites_mine_to_manage()::text'))->0->>'athlete_first_name' = 'Synthkid',
                'family page list carries the child''s first name');
  perform ri.ok(ri.as_('ADMIN', format('select jsonb_array_length(public.athlete_link_invites_for(%L))::text', ri.get('K1'))) = 'OK:2',
                'staff see them on the athlete page');
  perform ri.ok(ri.as_('BA', format('select public.athlete_link_invites_for(%L)::text', ri.get('K1'))) like 'ERR:NOT_FOUND%',
                'cross-tenant: org B admin cannot list');
  perform ri.ok(ri.as_('REL', 'select public.athlete_link_invites_mine_to_manage()::text') = 'OK:[]', 'the invitee manages nothing');

  -- Accept: the e-mail must match the confirmed sign-in e-mail.
  r := ri.as_('WR', format('select public.athlete_link_invite_accept(%L)::text', ri.hash('tok-rel-2')));
  perform ri.ok(r like 'ERR:EMAIL_MISMATCH%', 'another account cannot accept (' || r || ')');
  r := ri.as_('UNC', format('select public.athlete_link_invite_accept(%L)::text', ri.hash('tok-rel-2')));
  perform ri.ok(r like 'ERR:EMAIL_MISMATCH%', 'an unconfirmed e-mail cannot accept');
  r := ri.as_('REL', format('select public.athlete_link_invite_accept(%L)::text', ri.hash('nonsense')));
  perform ri.ok(r like 'ERR:NOT_FOUND%', 'unknown token refused');
  perform ri.ok(ri.as_('REL', format('select count(*)::text from public.athletes where id = %L', ri.get('K1'))) = 'OK:0',
                'before accepting the relative cannot read the child');
  r := ri.as_('REL', format('select public.athlete_link_invite_accept(%L)::text', ri.hash('tok-rel-2')));
  v := ri.j(r);
  perform ri.ok(v->>'ok' = 'true' and v->>'replayed' = 'false' and (v->>'athlete_id')::uuid = ri.get('K1'), 'the invited relative accepts (' || r || ')');
  perform ri.put('LINK_REL', v->>'link_id');
  perform ri.ok((select relation = 'aunt_uncle' and can_register and can_pay and receives_emails and not can_see_medical
                        and not can_edit_profile and not can_consent and granted_by = ri.get('G') and invitation_id = v_id and status = 'active'
                   from public.athlete_guardian_links where id = (v->>'link_id')::uuid),
                'per-child link created with the invitation''s relation and permissions');
  perform ri.ok((select status = 'accepted' and accepted_by = ri.get('REL') and token_hash is null and link_id = (v->>'link_id')::uuid
                   from public.athlete_link_invitations where id = v_id), 'invitation accepted, token consumed');
  perform ri.ok(exists (select 1 from public.participant_bookers where profile_id = ri.get('REL') and athlete_id = ri.get('K1') and scope = 'linked'),
                'booker identity synced (same effect as an approved link request)');
  perform ri.ok(exists (select 1 from public.audit_logs where target_id = v_id and action = 'participant.link.invite_accepted'), 'acceptance audited');
  perform ri.ok(ri.as_('REL', format('select count(*)::text from public.athletes where id = %L', ri.get('K1'))) = 'OK:1', 'the relative reads that child');
  perform ri.ok(ri.as_('REL', format('select count(*)::text from public.athletes where id = %L', ri.get('K2'))) = 'OK:0', 'but not the sibling');
  perform ri.ok(ri.as_('REL', format('select count(*)::text from public.families where id = %L', '00000000-0000-0000-0000-00000000e961')) = 'OK:0',
                'and not the family record');
  perform ri.ok(not exists (select 1 from public.family_members where profile_id = ri.get('REL') and family_id = '00000000-0000-0000-0000-00000000e961'),
                'the relative is never added to the child''s family');
  perform ri.ok(ri.as_('REL', 'select string_agg(x::text, '','') from public.my_athlete_ids() x') = 'OK:' || ri.txt('K1'),
                'My Athletes: exactly that child');

  -- Idempotent, single use.
  r := ri.as_('REL', format('select public.athlete_link_invite_accept(%L)::text', ri.hash('tok-rel-2')));
  perform ri.ok(r like 'ERR:NOT_FOUND%', 'single use: the consumed link opens nothing (' || r || ')');
  perform ri.ok((select count(*) from public.athlete_guardian_links where athlete_id = ri.get('K1') and profile_id = ri.get('REL')) = 1,
                'one link only');

  -- REL2 accepts too (family friend; no consent permission).
  r := ri.as_('REL2', format('select public.athlete_link_invite_accept(%L)::text', ri.hash('tok-rel2')));
  perform ri.ok(ri.j(r)->>'ok' = 'true', 'second relative accepts (' || r || ')');
  perform ri.put('LINK_REL2', ri.j(r)->>'link_id');
end $$;

-- Expiry, revoke, cap, rate limit.
do $$
declare r text; v_id uuid; i int;
begin
  insert into auth.users (id, email, email_confirmed_at) values
    ('00000000-0000-0000-0000-00000000e909', 'ri-exp@example.test', now()),
    ('00000000-0000-0000-0000-00000000e910', 'ri-rev@example.test', now());
  update public.profiles set org_id = '00000000-0000-0000-0000-000000000001' where id in ('00000000-0000-0000-0000-00000000e909', '00000000-0000-0000-0000-00000000e910');
  perform ri.put('EXP', '00000000-0000-0000-0000-00000000e909');
  perform ri.put('REV', '00000000-0000-0000-0000-00000000e910');

  r := ri.invite('G', 'K1', '{"email":"ri-exp@example.test","relation":"grandparent"}', 'tok-exp');
  v_id := (ri.j(r)->>'invitation_id')::uuid;
  update public.athlete_link_invitations set expires_at = now() - interval '1 minute' where id = v_id;
  r := ri.as_('EXP', format('select public.athlete_link_invite_accept(%L)::text', ri.hash('tok-exp')));
  perform ri.ok(r like 'ERR:EXPIRED%', 'expired invitation refused (' || r || ')');
  perform ri.ok(ri.j(ri.as_('EXP', format('select public.athlete_link_invite_view(%L)::text', ri.hash('tok-exp'))))->>'status' = 'expired',
                'the invitation page shows it as expired');
  perform ri.ok((select status from public.athlete_link_invitations where id = v_id) = 'expired', 'status set to expired');
  perform ri.ok(not exists (select 1 from public.athlete_guardian_links where profile_id = ri.get('EXP')), 'no link for an expired invitation');

  r := ri.invite('G', 'K1', '{"email":"ri-rev@example.test","relation":"other_carer"}', 'tok-rev');
  v_id := (ri.j(r)->>'invitation_id')::uuid;
  r := ri.as_('OUT', format('select public.athlete_link_invite_revoke(%L)::text', v_id));
  perform ri.ok(r like 'ERR:NOT_FOUND%', 'an outsider cannot revoke');
  r := ri.as_('BA', format('select public.athlete_link_invite_revoke(%L)::text', v_id));
  perform ri.ok(r like 'ERR:NOT_FOUND%', 'cross-tenant: org B cannot revoke');
  r := ri.as_('G2', format('select public.athlete_link_invite_revoke(%L)::text', v_id));
  perform ri.ok(ri.j(r)->>'status' = 'revoked', 'a family guardian revokes the pending invitation (' || r || ')');
  r := ri.as_('REV', format('select public.athlete_link_invite_accept(%L)::text', ri.hash('tok-rev')));
  perform ri.ok(r like 'ERR:NOT_FOUND%', 'a revoked invitation cannot be accepted');
  perform ri.ok(not exists (select 1 from public.athlete_guardian_links where profile_id = ri.get('REV')), 'no link for a revoked invitation');
  perform ri.ok(exists (select 1 from public.audit_logs where target_id = v_id and action = 'participant.link.invite_revoked'), 'revocation audited');
  -- Staff may revoke too.
  r := ri.invite('G', 'K1', '{"email":"ri-rev@example.test","relation":"other_carer"}', 'tok-rev2');
  r := ri.as_('ADMIN', format('select public.athlete_link_invite_revoke(%L)::text', (ri.j(r)->>'invitation_id')::uuid));
  perform ri.ok(ri.j(r)->>'status' = 'revoked', 'an admin of the club can revoke');

  -- Cap: 10 pending per child.
  for i in 1..10 loop
    r := ri.invite('G', 'K2', jsonb_build_object('email', 'ri-cap' || i || '@example.test', 'relation', 'family_friend'), 'tok-cap-' || i);
  end loop;
  perform ri.ok(ri.j(r)->>'ok' = 'true', 'ten pending invitations for one child accepted');
  r := ri.invite('G', 'K2', '{"email":"ri-cap11@example.test","relation":"family_friend"}', 'tok-cap-11');
  perform ri.ok(r like 'ERR:INVITE_LIMIT%', 'the eleventh pending invitation is refused (' || r || ')');
  -- Rate limit: 20 new invitations per inviter per day.
  insert into public.athlete_link_invitations (org_id, athlete_id, invited_by, email, relation, expires_at, status)
  select '00000000-0000-0000-0000-000000000001', ri.get('K1'), ri.get('G2'), 'ri-rate' || g || '@example.test', 'other_carer', now(), 'revoked'
    from generate_series(1, 20) g;
  r := ri.invite('G2', 'K1', '{"email":"ri-rate-next@example.test","relation":"family_friend"}', 'tok-rate');
  perform ri.ok(r like 'ERR:RATE_LIMITED%', 'more than 20 new invitations a day refused (' || r || ')');
end $$;

-- ===========================================================================
-- B. Carer consent
-- ===========================================================================
do $$
declare r text; v jsonb; v_req uuid; v_reg uuid; v_keys jsonb; v_nohealth jsonb;
begin
  select jsonb_agg(key) into v_keys from public.consent_forms where org_id = '00000000-0000-0000-0000-000000000001' and is_active;
  select jsonb_agg(key) into v_nohealth from public.consent_forms where org_id = '00000000-0000-0000-0000-000000000001' and is_active and key <> 'health';

  -- Setting OFF: as today.
  r := ri.as_('REL', format('select public.linker_consent_status(%L)::text', ri.get('K1')));
  perform ri.ok(ri.j(r)->>'can_consent' = 'false' and ri.j(r)->>'reason' = 'CARER_CONSENT_DISABLED', 'OFF: the linker cannot consent (' || r || ')');
  r := ri.as_('REL', format('select public.third_party_camp_hold(%L, %L)::text',
              ri.hold(ri.get('K1'), '00000000-0000-0000-0000-00000000e9e1', 'tok-hold-1'), gen_random_uuid()));
  v := ri.j(r);
  v_req := (v->>'consent_request_id')::uuid;
  perform ri.put('REQ1', v_req::text);
  perform ri.ok(v->>'status' = 'awaiting_consent', 'OFF: the linker''s booking is held (' || r || ')');
  perform ri.ok((select existing_child and guardian_email = 'ri-guardian@example.test' and status = 'pending'
                   from public.guardian_consent_requests where id = v_req),
                'OFF: consent request addressed to the family''s primary guardian');
  r := ri.as_('REL', format('select public.linker_consent_accept(%L, %L)::text', v_req, jsonb_build_object('accepted_keys', v_keys)));
  perform ri.ok(r like 'ERR:CARER_CONSENT_DISABLED%', 'OFF: linker_consent_accept refused (' || r || ')');
  perform ri.ok((select status from public.guardian_consent_requests where id = v_req) = 'pending', 'OFF: the request stays with the guardian');
  r := ri.as_('G', format('select public.athlete_link_update(%L, ''{"can_consent":true}'')::text', ri.get('LINK_REL')));
  perform ri.ok(r like 'OK:%' and not (select can_consent from public.athlete_guardian_links where id = ri.get('LINK_REL')),
                'OFF: granting can_consent is stored as not granted (' || r || ')');
  r := ri.as_('G', format('select public.participant_link_decide(%L, ''approve'', ''{"scope":"athlete","can_consent":true}'', null)::text', gen_random_uuid()));
  perform ri.ok(r like 'ERR:NOT_FOUND%', 'link decide with an unknown request: NOT_FOUND');

  -- Setting ON.
  perform ri.set_carer(true);
  perform ri.ok(ri.as_('G', 'select public.carer_consent_setting()::text') = 'OK:true', 'setting visible to the forms');
  r := ri.as_('REL', format('select public.linker_consent_status(%L)::text', ri.get('K1')));
  perform ri.ok(ri.j(r)->>'reason' = 'NO_CONSENT_PERMISSION', 'ON without can_consent: not allowed (' || r || ')');
  r := ri.as_('REL', format('select public.linker_consent_accept(%L, %L)::text', v_req, jsonb_build_object('accepted_keys', v_keys)));
  perform ri.ok(r like 'ERR:NO_CONSENT_PERMISSION%', 'ON without can_consent: accept refused');
  r := ri.as_('REL', format('select public.athlete_link_update(%L, ''{"can_consent":true}'')::text', ri.get('LINK_REL')));
  perform ri.ok(r like 'ERR:NOT_FOUND%', 'the linker cannot grant themselves can_consent');
  r := ri.as_('G', format('select public.athlete_link_update(%L, ''{"can_consent":true}'')::text', ri.get('LINK_REL')));
  perform ri.ok(ri.j(r)->>'ok' = 'true', 'ON: the guardian grants can_consent (' || r || ')');
  perform ri.ok(exists (select 1 from public.audit_logs where target_id = ri.get('LINK_REL') and action = 'participant.link.permissions'
                          and (new_data->'after'->>'can_consent')::boolean), 'grant audited (before / after)');
  -- Health declaration: required, the linker has no medical access.
  r := ri.as_('REL', format('select public.linker_consent_status(%L)::text', ri.get('K1')));
  perform ri.ok(ri.j(r)->>'reason' = 'HEALTH_NEEDS_GUARDIAN', 'health declaration needs the family without can_see_medical (' || r || ')');
  r := ri.as_('REL', format('select public.linker_consent_accept(%L, %L)::text', v_req, jsonb_build_object('accepted_keys', v_keys)));
  perform ri.ok(r like 'ERR:HEALTH_NEEDS_GUARDIAN%', 'health rule enforced on accept');
  perform ri.ok(ri.as_('REL', 'select public.linker_consent_pending()::text') = 'OK:[]', 'nothing to consent to while the health rule blocks');
  -- With can_see_medical the linker may consent to everything.
  r := ri.as_('G', format('select public.athlete_link_update(%L, ''{"can_see_medical":true}'')::text', ri.get('LINK_REL')));
  r := ri.as_('REL', format('select public.linker_consent_status(%L)::text', ri.get('K1')));
  perform ri.ok(ri.j(r)->>'can_consent' = 'true' and jsonb_array_length(ri.j(r)->'forms') = jsonb_array_length(v_keys), 'ON + can_consent + medical: allowed, forms listed');
  r := ri.as_('REL', 'select public.linker_consent_pending()::text');
  perform ri.ok((ri.j(r)->0->>'request_id')::uuid = v_req, 'pending request offered to the linker');
  r := ri.as_('REL', format('select public.linker_consent_accept(%L, %L)::text', v_req, jsonb_build_object('accepted_keys', v_nohealth)));
  perform ri.ok(r like 'ERR:CONSENT_REQUIRED%', 'every required form must be accepted');
  r := ri.as_('G3', format('select public.linker_consent_accept(%L, %L)::text', v_req, jsonb_build_object('accepted_keys', v_keys)));
  perform ri.ok(r like 'ERR:NOT_FOUND%', 'someone else cannot use the linker path');
  r := ri.as_('REL', format('select public.linker_consent_accept(%L, %L)::text', v_req, jsonb_build_object('accepted_keys', v_keys)));
  perform ri.ok(ri.j(r)->>'ok' = 'true' and ri.j(r)->>'relation' = 'aunt_uncle', 'ON: the linker consents themselves (' || r || ')');
  perform ri.ok((select status = 'accepted' and accepted_by = ri.get('REL') and accepted_via = 'linker' and accepted_relation = 'aunt_uncle'
                        and token_hash is null
                   from public.guardian_consent_requests where id = v_req), 'request accepted by the linker (no guardian link left)');
  perform ri.ok((select count(*) from public.consent_acceptances where athlete_id = ri.get('K1') and accepted_by = ri.get('REL')
                   and accepted_relation = 'aunt_uncle') = jsonb_array_length(v_keys), 'consents recorded: accepted_by = linker, with relation');
  select (select id from public.registrations where athlete_id = ri.get('K1') and camp_edition_id = '00000000-0000-0000-0000-00000000e9e1') into v_reg;
  perform ri.ok((select i.payer_profile_id = ri.get('REL') and i.payer_kind = 'other'
                   from public.registrations g join public.invoices i on i.id = g.invoice_id where g.id = v_reg),
                'the booking proceeds: invoice to the linker');
  perform ri.ok(exists (select 1 from public.audit_logs where target_id = v_req and action = 'guardian_consent.accepted_by_carer'),
                'carer consent audited');
  r := ri.as_('REL', format('select public.linker_consent_accept(%L, %L)::text', v_req, jsonb_build_object('accepted_keys', v_keys)));
  perform ri.ok(ri.j(r)->>'replayed' = 'true', 'replay is idempotent');

  -- ON, linker without can_consent: as today.
  r := ri.as_('REL2', format('select public.third_party_camp_hold(%L, %L)::text',
              ri.hold(ri.get('K1'), '00000000-0000-0000-0000-00000000e9e2', 'tok-hold-rel2'), gen_random_uuid()));
  v_req := (ri.j(r)->>'consent_request_id')::uuid;
  perform ri.ok((select existing_child and status = 'pending' and guardian_email = 'ri-guardian@example.test'
                   from public.guardian_consent_requests where id = v_req), 'ON without can_consent: request to the guardian (' || r || ')');
  r := ri.as_('REL2', format('select public.linker_consent_accept(%L, %L)::text', v_req, jsonb_build_object('accepted_keys', v_keys)));
  perform ri.ok(r like 'ERR:NO_CONSENT_PERMISSION%', 'ON without can_consent: the linker cannot consent');

  -- Setting OFF after the grant: nothing new is granted.
  perform ri.set_carer(false);
  perform ri.ok((select can_consent from public.athlete_guardian_links where id = ri.get('LINK_REL')), 'stored can_consent flag kept');
  perform ri.ok(ri.as_('REL', format('select public.athlete_link_can(%L, ''consent'')::text', ri.get('K1'))) = 'OK:false',
                'OFF again: the stored flag is ignored');
  r := ri.as_('REL', format('select public.third_party_camp_hold(%L, %L)::text',
              ri.hold(ri.get('K1'), '00000000-0000-0000-0000-00000000e9e3', 'tok-hold-3'), gen_random_uuid()));
  v_req := (ri.j(r)->>'consent_request_id')::uuid;
  r := ri.as_('REL', format('select public.linker_consent_accept(%L, %L)::text', v_req, jsonb_build_object('accepted_keys', v_keys)));
  perform ri.ok(r like 'ERR:CARER_CONSENT_DISABLED%', 'OFF again: no consent power (' || r || ')');
  perform ri.ok((select status from public.guardian_consent_requests where id = v_req) = 'pending', 'OFF again: the guardian is asked');
  r := ri.as_('REL', format('select public.linker_consent_ask_family(%L, %L)::text', v_req, ri.hash('tok-ask')));
  perform ri.ok(ri.j(r)->>'ok' = 'true' and (select token_hash from public.guardian_consent_requests where id = v_req) = ri.hash('tok-ask'),
                'the linker can (re)send the request to the family');
  perform ri.ok(ri.as_('G3', format('select public.linker_consent_ask_family(%L, %L)::text', v_req, ri.hash('tok-ask2'))) like 'ERR:NOT_FOUND%',
                'only the booker can re-send');
  -- The family guardian still consents the usual way.
  r := ri.as_('G', format('select public.guardian_consent_accept(%L, %L)::text', ri.hash('tok-ask'), jsonb_build_object('accepted_keys', v_keys)));
  perform ri.ok(ri.j(r)->>'ok' = 'true', 'the family guardian consents as today');
  -- Invitation with can_consent while ON, accepted after the setting went OFF: not granted.
  perform ri.set_carer(true);
  insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-00000000e911', 'ri-late@example.test', now());
  update public.profiles set org_id = '00000000-0000-0000-0000-000000000001' where id = '00000000-0000-0000-0000-00000000e911';
  perform ri.put('LATE', '00000000-0000-0000-0000-00000000e911');
  r := ri.invite('G', 'K1', '{"email":"ri-late@example.test","relation":"grandparent","can_consent":true}', 'tok-late');
  perform ri.ok(ri.j(r)->>'ok' = 'true', 'ON: an invitation may carry can_consent (' || r || ')');
  perform ri.set_carer(false);
  r := ri.as_('LATE', format('select public.athlete_link_invite_accept(%L)::text', ri.hash('tok-late')));
  perform ri.ok((select not can_consent from public.athlete_guardian_links where id = (ri.j(r)->>'link_id')::uuid),
                'accepted while OFF: can_consent not granted (' || r || ')');
  -- Cross-tenant: no consent status for another club's child.
  r := ri.as_('REL', format('select public.linker_consent_status(%L)::text', ri.get('BK')));
  perform ri.ok(ri.j(r)->>'reason' = 'NOT_LINKED', 'cross-tenant: an org B child is never consentable');
  perform ri.ok(ri.as_('BA', format('select public.linker_consent_accept(%L, ''{}'')::text', ri.txt('REQ1'))) like 'ERR:NOT_FOUND%',
                'cross-tenant: org B cannot touch the request');
end $$;

-- ===========================================================================
-- C. Message audience
-- ===========================================================================
do $$
declare v_team1 uuid := gen_random_uuid(); v_team2 uuid := gen_random_uuid(); v_a1 uuid; v_a2 uuid; v_a3 uuid; v_svc uuid := gen_random_uuid();
        v_b uuid := gen_random_uuid(); n int; v_coach uuid := gen_random_uuid();
begin
  -- REL (receives_emails), REL2 (opts out), LATE (receives), G2 forced as linker too (dedup).
  update public.athlete_guardian_links set receives_emails = false where id = ri.get('LINK_REL2');
  insert into public.athlete_guardian_links (org_id, athlete_id, profile_id, relation, granted_by)
  values ('00000000-0000-0000-0000-000000000001', ri.get('K1'), ri.get('G2'), 'other_carer', ri.get('G'));
  perform ri.ok((select array_agg(profile_id order by profile_id) from public.athlete_linked_recipients('00000000-0000-0000-0000-000000000001', array[ri.get('K1')]))
                = array[ri.get('REL'), ri.get('LATE')], 'linked recipients of K1: receiving linkers only (opt-out and family members excluded)');
  perform ri.ok(not exists (select 1 from public.athlete_linked_recipients('00000000-0000-0000-0000-000000000001', array[ri.get('K2')])),
                'no linker of the sibling: nothing for K2');
  perform ri.ok(not exists (select 1 from public.athlete_linked_recipients('10000000-0000-0000-0000-000000000002', array[ri.get('K1')])),
                'cross-tenant: another org id returns nothing');
  perform ri.ok(ri.as_('REL', format('select count(*)::text from public.athlete_linked_recipients(%L, array[%L]::uuid[])',
                                     '00000000-0000-0000-0000-000000000001', ri.get('K1'))) like 'ERR:%',
                'the helper is not callable through the API');
  perform ri.ok(jsonb_array_length(public.athlete_linked_recipients_for('00000000-0000-0000-0000-000000000001', array[ri.get('K1'), ri.get('K2')])) = 2,
                'service helper for server notices');

  -- Team announcements.
  insert into public.teams (id, org_id, name, sport) values
    (v_team1, '00000000-0000-0000-0000-000000000001', 'RI Team K1', 'basketball'),
    (v_team2, '00000000-0000-0000-0000-000000000001', 'RI Team K2', 'basketball');
  insert into public.team_memberships (org_id, team_id, athlete_id, status, joined_on) values
    ('00000000-0000-0000-0000-000000000001', v_team1, ri.get('K1'), 'active', current_date - 10),
    ('00000000-0000-0000-0000-000000000001', v_team2, ri.get('K2'), 'active', current_date - 10);
  insert into public.club_alerts (org_id, title, audience, team_id) values ('00000000-0000-0000-0000-000000000001', 'Synthetic team 1 notice', 'team', v_team1) returning id into v_a1;
  insert into public.club_alerts (org_id, title, audience, team_id) values ('00000000-0000-0000-0000-000000000001', 'Synthetic team 2 notice', 'team', v_team2) returning id into v_a2;
  insert into public.club_alerts (org_id, title, audience) values ('00000000-0000-0000-0000-000000000001', 'Synthetic staff notice', 'staff') returning id into v_a3;
  perform ri.ok(exists (select 1 from public.club_alert_recipients(v_a1) where profile_id = ri.get('REL')), 'team alert of the linked child reaches the linker');
  perform ri.ok(exists (select 1 from public.club_alert_recipients(v_a1) where profile_id = ri.get('G')), 'and the family');
  select count(*) into n from public.club_alert_recipients(v_a1) where profile_id = ri.get('G2');
  perform ri.ok(n = 1, 'a guardian who is also a linker gets one copy');
  perform ri.ok(not exists (select 1 from public.club_alert_recipients(v_a1) where profile_id = ri.get('REL2')), 'opted-out linker excluded');
  perform ri.ok(not exists (select 1 from public.club_alert_recipients(v_a2) where profile_id in (ri.get('REL'), ri.get('LATE'))),
                'sibling''s team alert: no linker of K1');
  perform ri.ok(not exists (select 1 from public.club_alert_recipients(v_a3) where profile_id = ri.get('REL')), 'staff alert: no linker');
  perform ri.ok(ri.as_('REL', format('select public.club_alert_for_me(''team'', %L, null, null)::text', v_team1)) = 'OK:true',
                'banner: the linker sees the alert of their child''s team');
  perform ri.ok(ri.as_('REL', format('select public.club_alert_for_me(''team'', %L, null, null)::text', v_team2)) = 'OK:false',
                'banner: not the sibling''s team');
  perform ri.ok(ri.as_('REL', format('select count(*)::text from public.club_alerts where id in (%L, %L)', v_a1, v_a2)) = 'OK:1',
                'RLS on alerts: one (own child''s team)');

  -- Training booking notices for K1 (booked by the family).
  insert into public.training_services (id, org_id, slug, name, duration_min, price_chf, kind, session_type, max_participants, currency)
  values (v_svc, '00000000-0000-0000-0000-000000000001', 'ri-pt', 'RI Personal Training', 60, 80, 'private', 'individual', 1, 'CHF');
  insert into public.coaches (id, org_id, display_name) values (v_coach, '00000000-0000-0000-0000-000000000001', 'Synthetic RI Coach');
  insert into public.training_bookings (id, org_id, athlete_id, service_id, coach_id, slot_start, status)
  values (v_b, '00000000-0000-0000-0000-000000000001', ri.get('K1'), v_svc, v_coach, date_trunc('hour', now()) + interval '3 days', 'booked');
  perform public.bk_enqueue_notifications(v_b, 'confirmed');
  perform ri.ok((select array_agg(recipient_profile_id order by recipient_profile_id) from public.booking_notifications
                  where booking_id = v_b and recipient_kind = 'linked') = array[ri.get('REL'), ri.get('LATE')],
                'booking confirmation: receiving linkers of the child (kind linked)');
  perform ri.ok((select count(*) from public.booking_notifications where booking_id = v_b and recipient_profile_id = ri.get('G2')) = 1,
                'booking notice: a guardian-linker gets one copy');
  perform ri.ok(not exists (select 1 from public.booking_notifications where booking_id = v_b and recipient_profile_id = ri.get('REL2')),
                'booking notice: opt-out respected');
  perform ri.ok((select recipient_email from public.booking_notifications where booking_id = v_b and recipient_profile_id = ri.get('REL')) = 'ri-rel@example.test',
                'linker notice carries their own e-mail');
end $$;

select 'PASS — relative invitations suite completed' as result;
