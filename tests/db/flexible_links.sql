-- ============================================================================
-- Flexible links, manual registrations, finance scope
-- (migration 20250420106300_flexible_links_finance_scope.sql)
--
--   A. "This child only": an aunt linked to K1 sees K1 only — not the sibling,
--      the family, family invoices, medical (until allowed) or profile edits
--      (until allowed); My Athletes lists K1 as kind 'linked'.
--   B. Permissions changed by the guardian: medical read (never write),
--      profile edits; REGISTER_NEEDS_PAY; who may change / list links.
--   C. Booking as a linker: camp hold through the guardian consent flow; only
--      a family guardian can consent (booker / outsider refused); invoice to
--      the linker as payer.
--   D. Revocation is immediate: no row, no booking, pending hold cancelled.
--   E. "Whole family" link unchanged (family_members, sees every child) and
--      it supersedes a per-child link.
--   F. Manual registrations: NO_GUARDIAN_LOGIN suggestion (not a problem),
--      dismissed never re-raised, auto-resolved once a login exists,
--      reclassification of open ATHLETE_WITHOUT_GUARDIAN flags (re-run safe).
--   G. Finance: no athletes table read / write; billing_athletes has the
--      billing columns only; sponsorship RPC; admins unaffected.
--   H. Cross-tenant denial for the new table, view and every new RPC.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2). Org B
-- 10000000-…0002 (seed_tenants.sql). SYNTHETIC DATA ONLY. Every assertion
-- prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema fl;
grant usage on schema fl to authenticated, anon, service_role;
create table fl.ctx (k text primary key, v text);
grant all on fl.ctx to authenticated, anon, service_role;

create function fl.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function fl.put(p_k text, p_v text) returns void language sql as $$
  insert into fl.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function fl.get(p_k text) returns uuid language sql stable as $$ select v::uuid from fl.ctx where k = p_k $$;
create function fl.txt(p_k text) returns text language sql stable as $$ select v from fl.ctx where k = p_k $$;
create function fl.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
create function fl.as_(p_who text, p_sql text) returns text language sql as $$ select fl.run_as(fl.get(p_who), p_sql) $$;
create function fl.j(p_res text) returns jsonb language sql immutable as $$
  select case when p_res like 'OK:%' and p_res <> 'OK:<null>' then substr(p_res, 4)::jsonb end
$$;
create function fl.hash(p_token text) returns text language sql immutable as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;
grant execute on all functions in schema fl to authenticated, anon, service_role;

-- Fixtures -----------------------------------------------------------------------
-- G    primary guardian of family F (K1 with medical data, sibling K2; a family invoice)
-- G2   guardian of family F2 (K3) — an unrelated parent
-- AU   aunt: requests "this child only" access to K1
-- P2   second parent: requests "whole family" access via K2
-- GP   grandparent: approved by staff with custom permissions
-- OUT  an outsider login (no family)
-- K5   staff-created child of family F5 (contact e-mail, no login); K6 likewise (F6)
-- BA   admin of org B; BK child of org B
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000fa0a1', 'fl-guardian@example.test', now()),
  ('00000000-0000-0000-0000-0000000fa0a2', 'fl-guardian-two@example.test', now()),
  ('00000000-0000-0000-0000-0000000fa0a3', 'fl-aunt@example.test', now()),
  ('00000000-0000-0000-0000-0000000fa0a4', 'fl-second-parent@example.test', now()),
  ('00000000-0000-0000-0000-0000000fa0a5', 'fl-grandparent@example.test', now()),
  ('00000000-0000-0000-0000-0000000fa0a6', 'fl-outsider@example.test', now()),
  ('b0000000-0000-0000-0000-0000000fa0f1', 'fl-admin-b@example.test', now());
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Guardian FL'
 where id = '00000000-0000-0000-0000-0000000fa0a1';
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Guardian Two FL'
 where id = '00000000-0000-0000-0000-0000000fa0a2';
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Aunt'
 where id = '00000000-0000-0000-0000-0000000fa0a3';
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Second Parent'
 where id = '00000000-0000-0000-0000-0000000fa0a4';
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Grandparent'
 where id = '00000000-0000-0000-0000-0000000fa0a5';
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Outsider'
 where id = '00000000-0000-0000-0000-0000000fa0a6';
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000fa0f1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000fa0f1', 'admin');

insert into public.families (id, org_id, name, contact_email) values
  ('00000000-0000-0000-0000-0000000fa061', '00000000-0000-0000-0000-000000000001', 'Synthetic FL Family', 'fl-guardian@example.test'),
  ('00000000-0000-0000-0000-0000000fa062', '00000000-0000-0000-0000-000000000001', 'Synthetic FL Family Two', 'fl-guardian-two@example.test'),
  ('00000000-0000-0000-0000-0000000fa065', '00000000-0000-0000-0000-000000000001', 'Synthetic FL Manual', 'fl-manual@example.test'),
  ('00000000-0000-0000-0000-0000000fa066', '00000000-0000-0000-0000-000000000001', 'Synthetic FL Manual Two', 'fl-manual-two@example.test');
insert into public.family_members (family_id, profile_id, relation, is_primary, can_pay, can_see_medical, receives_emails) values
  ('00000000-0000-0000-0000-0000000fa061', '00000000-0000-0000-0000-0000000fa0a1', 'mother', true, true, true, true),
  ('00000000-0000-0000-0000-0000000fa062', '00000000-0000-0000-0000-0000000fa0a2', 'father', true, true, true, true);
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, gender, status, height_cm, school) values
  ('00000000-0000-0000-0000-0000000fa071', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa061', 'Synthetic', 'Flone', current_date - interval '11 years', 'male', 'active', 150, 'Synthetic School'),
  ('00000000-0000-0000-0000-0000000fa072', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa061', 'Synthetic', 'Fltwo', current_date - interval '9 years', 'female', 'active', 130, null),
  ('00000000-0000-0000-0000-0000000fa073', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa062', 'Synthetic', 'Flthree', current_date - interval '10 years', 'male', 'active', null, null),
  ('00000000-0000-0000-0000-0000000fa075', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa065', 'Synthetic', 'Flmanual', current_date - interval '12 years', 'male', 'active', null, null),
  ('00000000-0000-0000-0000-0000000fa076', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa066', 'Synthetic', 'Flmanualtwo', current_date - interval '12 years', 'female', 'active', null, null);
insert into public.athlete_medical (org_id, athlete_id, allergies) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa071', 'Synthetic allergy');
insert into public.invoices (id, org_id, number, family_id, description, status, due_date, currency, total_chf) values
  ('00000000-0000-0000-0000-0000000fa091', '00000000-0000-0000-0000-000000000001', 'SYN-FL-1', '00000000-0000-0000-0000-0000000fa061',
   'Synthetic family invoice', 'sent', current_date + 14, 'CHF', 120);
insert into public.families (id, org_id, name) values ('b0000000-0000-0000-0000-0000000fa061', '10000000-0000-0000-0000-000000000002', 'Synthetic FL B');
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, gender, status) values
  ('b0000000-0000-0000-0000-0000000fa071', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000fa061', 'Synthetic', 'Flb', '2014-01-01', 'male', 'active');

select fl.put('G', '00000000-0000-0000-0000-0000000fa0a1');
select fl.put('G2', '00000000-0000-0000-0000-0000000fa0a2');
select fl.put('AU', '00000000-0000-0000-0000-0000000fa0a3');
select fl.put('P2', '00000000-0000-0000-0000-0000000fa0a4');
select fl.put('GP', '00000000-0000-0000-0000-0000000fa0a5');
select fl.put('OUT', '00000000-0000-0000-0000-0000000fa0a6');
select fl.put('BA', 'b0000000-0000-0000-0000-0000000fa0f1');
select fl.put('ADMIN', '00000000-0000-0000-0000-0000000000f1');
select fl.put('FIN', '00000000-0000-0000-0000-0000000000f2');
select fl.put('K1', '00000000-0000-0000-0000-0000000fa071');
select fl.put('K2', '00000000-0000-0000-0000-0000000fa072');
select fl.put('K3', '00000000-0000-0000-0000-0000000fa073');
select fl.put('K5', '00000000-0000-0000-0000-0000000fa075');
select fl.put('K6', '00000000-0000-0000-0000-0000000fa076');
select fl.put('BK', 'b0000000-0000-0000-0000-0000000fa071');
select fl.put('F', '00000000-0000-0000-0000-0000000fa061');
select fl.put('start', (current_date + 30)::text);

-- Link requests (as participant_link_request would store them).
insert into public.athlete_link_requests (id, org_id, athlete_id, requester_profile_id, relation) values
  ('00000000-0000-0000-0000-0000000fa0b1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa071', '00000000-0000-0000-0000-0000000fa0a3', 'other'),
  ('00000000-0000-0000-0000-0000000fa0b2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa072', '00000000-0000-0000-0000-0000000fa0a4', 'father'),
  ('00000000-0000-0000-0000-0000000fa0b3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa071', '00000000-0000-0000-0000-0000000fa0a5', 'other'),
  ('00000000-0000-0000-0000-0000000fa0b4', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa071', '00000000-0000-0000-0000-0000000fa0a4', 'father');

-- A paid camp (8-14) with two open weeks.
do $$
declare s date := fl.txt('start')::date;
begin
  insert into public.programs (id, org_id, slug, name, kind, price_chf, is_public, is_active, status, currency, min_age, max_age)
  values ('00000000-0000-0000-0000-0000000fa041', '00000000-0000-0000-0000-000000000001', 'fl-camp', 'Synthetic Link Camp',
          'camp', 0, true, true, 'published', 'CHF', 8, 14);
  insert into public.camp_editions (id, org_id, program_id, name, starts_on, ends_on, capacity, status) values
    ('00000000-0000-0000-0000-0000000fa0e1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa041', 'W1', s, s + 4, 5, 'published'),
    ('00000000-0000-0000-0000-0000000fa0e2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa041', 'W2', s + 7, s + 11, 5, 'published');
  insert into public.camp_age_groups (id, org_id, program_id, label, min_age, max_age) values
    ('00000000-0000-0000-0000-0000000fa0a0', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa041', '8-14', 8, 14);
  insert into public.camp_price_options (id, org_id, program_id, edition_id, label, days_count, includes_lunch, price) values
    ('00000000-0000-0000-0000-0000000fa0c1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa041', null, 'Full week', 5, true, 250);
end $$;
create function fl.hold(p_athlete uuid, p_edition uuid, p_token text) returns jsonb language sql stable as $$
  select jsonb_build_object('program_id', '00000000-0000-0000-0000-0000000fa041', 'edition_id', p_edition,
                            'athlete_id', p_athlete, 'age_group_id', '00000000-0000-0000-0000-0000000fa0a0',
                            'price_option_id', '00000000-0000-0000-0000-0000000fa0c1',
                            'days', (select jsonb_agg(to_char(d, 'YYYY-MM-DD') order by d)
                                       from public.camp_editions e, generate_series(e.starts_on, e.ends_on, interval '1 day') d
                                      where e.id = p_edition),
                            'token_hash', fl.hash(p_token))
$$;
grant execute on all functions in schema fl to authenticated, anon, service_role;

-- ===========================================================================
-- A. "This child only"
-- ===========================================================================
do $$
declare r text; v jsonb; v_link uuid;
begin
  -- Before approval: nothing.
  perform fl.ok(fl.as_('AU', format('select count(*)::text from public.athletes where id = %L', fl.get('K1'))) = 'OK:0',
                'before approval the aunt cannot read the child');
  -- The requester cannot approve their own request; an unrelated guardian cannot either.
  r := fl.as_('AU', $q$select public.participant_link_decide('00000000-0000-0000-0000-0000000fa0b1', 'approve', '{"scope":"athlete"}'::jsonb, null)::text$q$);
  perform fl.ok(r like 'ERR:NOT_FOUND%', 'requester cannot approve their own link (' || r || ')');
  r := fl.as_('G2', $q$select public.participant_link_decide('00000000-0000-0000-0000-0000000fa0b1', 'approve', '{"scope":"athlete"}'::jsonb, null)::text$q$);
  perform fl.ok(r like 'ERR:NOT_FOUND%', 'guardian of another family cannot approve');
  r := fl.as_('G', $q$select public.participant_link_decide('00000000-0000-0000-0000-0000000fa0b1', 'approve', '{"scope":"nonsense"}'::jsonb, null)::text$q$);
  perform fl.ok(r like 'ERR:INVALID_SCOPE%', 'unknown scope refused');
  r := fl.as_('G', $q$select public.participant_link_decide('00000000-0000-0000-0000-0000000fa0b1', 'approve', '{"scope":"athlete","relation":"aunt_uncle"}'::jsonb, null)::text$q$);
  v := fl.j(r);
  perform fl.ok(v->>'status' = 'approved' and v->>'scope' = 'athlete', 'guardian approves "this child only" (' || r || ')');
  select id into v_link from public.athlete_guardian_links where athlete_id = fl.get('K1') and profile_id = fl.get('AU') and status = 'active';
  perform fl.put('LINK_AU', v_link::text);
  perform fl.ok((select can_register and can_pay and not can_see_medical and receives_emails and not can_edit_profile
                        and relation = 'aunt_uncle' and granted_by = fl.get('G')
                   from public.athlete_guardian_links where id = v_link),
                'defaults: register + pay + e-mails on, medical + profile edits off');
  perform fl.ok(not exists (select 1 from public.family_members where profile_id = fl.get('AU')),
                'no family_members row for a per-child link');
  perform fl.ok(exists (select 1 from public.audit_logs where action = 'participant.link.approved' and target_id = '00000000-0000-0000-0000-0000000fa0b1'
                          and new_data->>'scope' = 'athlete')
                and exists (select 1 from public.audit_logs where target_table = 'athlete_guardian_links' and target_id = v_link),
                'grant audited (decision + row audit)');
  -- What the aunt sees.
  perform fl.ok(fl.as_('AU', format('select first_name || '' '' || last_name from public.athletes where id = %L', fl.get('K1'))) = 'OK:Synthetic Flone',
                'aunt reads the linked child');
  perform fl.ok(fl.as_('AU', format('select count(*)::text from public.athletes where id = %L', fl.get('K2'))) = 'OK:0',
                'aunt cannot read the sibling');
  perform fl.ok(fl.as_('AU', format('select count(*)::text from public.families where id = %L', fl.get('F'))) = 'OK:0',
                'aunt cannot read the family (address, contact)');
  perform fl.ok(fl.as_('AU', 'select count(*)::text from public.invoices where id = ''00000000-0000-0000-0000-0000000fa091''') = 'OK:0',
                'aunt cannot read the family billing');
  perform fl.ok(fl.as_('AU', format('select count(*)::text from public.family_members where family_id = %L', fl.get('F'))) = 'OK:0',
                'aunt cannot list the family guardians');
  perform fl.ok(fl.as_('AU', format('select count(*)::text from public.athlete_medical where athlete_id = %L', fl.get('K1'))) = 'OK:0',
                'aunt cannot read medical data without can_see_medical');
  perform fl.ok(fl.as_('AU', format('select public.is_guardian_of_athlete(%L)::text', fl.get('K1'))) = 'OK:false',
                'aunt is not a family guardian (family-wide checks stay false)');
  r := fl.as_('AU', format($q$select public.participant_update(%L, '{"first_name":"Changed"}'::jsonb, null)::text$q$, fl.get('K1')));
  perform fl.ok(r like 'ERR:NOT_ALLOWED%', 'aunt cannot edit the profile without can_edit_profile (' || r || ')');
  r := fl.as_('AU', format('update public.athletes set school = ''Hack'' where id = %L returning id::text', fl.get('K1')));
  perform fl.ok(r = 'OK:<null>' or r like 'ERR:%', 'aunt cannot update the athlete row directly (' || r || ')');
  perform fl.ok((select school from public.athletes where id = fl.get('K1')) = 'Synthetic School', 'athlete row unchanged');
  -- My Athletes / switcher.
  v := fl.j(fl.as_('AU', 'select public.my_athletes()::text'));
  perform fl.ok(jsonb_array_length(v) = 1 and v->0->>'id' = fl.txt('K1') and v->0->>'kind' = 'linked'
                and v->0->'link'->>'relation' = 'aunt_uncle' and v->0->>'family_id' is null and v->0->'sports' = 'null'::jsonb,
                'My Athletes: the linked child only, kind linked, relation, no family id / sports (' || coalesce(v::text, 'null') || ')');
  perform fl.ok(fl.as_('AU', format('select public.my_athlete_resolve(%L)::text', fl.get('K1'))) = 'OK:' || fl.txt('K1')
                and fl.as_('AU', format('select public.my_athlete_resolve(%L)::text', fl.get('K2'))) = 'OK:<null>',
                'switcher: linked child selectable, sibling not');
  -- The family guardian sees the link; the aunt reads her own row only.
  v := fl.j(fl.as_('G', format('select public.athlete_links_for(%L)::text', fl.get('K1'))));
  perform fl.ok(jsonb_array_length(v) = 1 and v->0->>'profile_id' = fl.txt('AU'), 'guardian lists the child''s per-child links');
  v := fl.j(fl.as_('G', 'select public.athlete_links_mine_to_manage()::text'));
  perform fl.ok(jsonb_array_length(v) = 1 and v->0->>'athlete_first_name' = 'Synthetic', 'guardian''s family page list');
  perform fl.ok(fl.as_('AU', 'select count(*)::text from public.athlete_guardian_links') = 'OK:1', 'aunt reads her own link');
  r := fl.as_('AU', format('select public.athlete_links_for(%L)::text', fl.get('K1')));
  perform fl.ok(r like 'ERR:NOT_FOUND%', 'aunt cannot list the child''s links');
  perform fl.ok(fl.as_('G2', 'select count(*)::text from public.athlete_guardian_links') = 'OK:0', 'unrelated guardian sees no link');
end $$;

-- ===========================================================================
-- B. Permissions
-- ===========================================================================
do $$
declare r text;
begin
  r := fl.as_('AU', format($q$select public.athlete_link_update(%L, '{"can_see_medical":true}'::jsonb)::text$q$, fl.get('LINK_AU')));
  perform fl.ok(r like 'ERR:NOT_FOUND%', 'aunt cannot change her own permissions');
  r := fl.as_('G2', format($q$select public.athlete_link_update(%L, '{"can_see_medical":true}'::jsonb)::text$q$, fl.get('LINK_AU')));
  perform fl.ok(r like 'ERR:NOT_FOUND%', 'another family cannot change the link');
  r := fl.as_('G', format($q$select public.athlete_link_update(%L, '{"can_pay":false}'::jsonb)::text$q$, fl.get('LINK_AU')));
  perform fl.ok(r like 'ERR:REGISTER_NEEDS_PAY%', 'booking without payment refused (invoices go to the linker) (' || r || ')');
  r := fl.as_('G', format($q$select public.athlete_link_update(%L, '{"can_see_medical":true,"can_edit_profile":true}'::jsonb)::text$q$, fl.get('LINK_AU')));
  perform fl.ok(r like 'OK:%', 'guardian grants medical + profile edits (' || r || ')');
  perform fl.ok(exists (select 1 from public.audit_logs where action = 'participant.link.permissions' and target_id = fl.get('LINK_AU')
                         and new_data->'before'->>'can_see_medical' = 'false' and new_data->'after'->>'can_see_medical' = 'true'),
                'permission change audited (before / after)');
  perform fl.ok(fl.as_('AU', format('select allergies from public.athlete_medical where athlete_id = %L', fl.get('K1'))) = 'OK:Synthetic allergy',
                'with can_see_medical the aunt reads medical data');
  r := fl.as_('AU', format('update public.athlete_medical set allergies = ''changed'' where athlete_id = %L returning id::text', fl.get('K1')));
  perform fl.ok((r = 'OK:<null>' or r like 'ERR:%') and (select allergies from public.athlete_medical where athlete_id = fl.get('K1')) = 'Synthetic allergy',
                'medical data stays family-written (aunt cannot change it) (' || r || ')');
  r := fl.as_('AU', format($q$select public.participant_update_sports(%L, '{"height_cm":"152"}'::jsonb)::text$q$, fl.get('K1')));
  perform fl.ok(r like 'OK:%' and (select height_cm from public.athletes where id = fl.get('K1')) = 152,
                'with can_edit_profile the aunt edits sports details (' || r || ')');
  -- Back to the defaults for the booking part (medical / edit off).
  perform fl.as_('G', format($q$select public.athlete_link_update(%L, '{"can_see_medical":false,"can_edit_profile":false}'::jsonb)::text$q$, fl.get('LINK_AU')));
  perform fl.ok(fl.as_('AU', format('select count(*)::text from public.athlete_medical where athlete_id = %L', fl.get('K1'))) = 'OK:0',
                'medical access withdrawn immediately');
  -- Staff decides with custom permissions (grandparent, view only).
  r := fl.as_('ADMIN', $q$select public.participant_link_decide('00000000-0000-0000-0000-0000000fa0b3', 'approve',
        '{"scope":"athlete","relation":"grandparent","can_register":false,"can_pay":false,"receives_emails":false}'::jsonb, null)::text$q$);
  perform fl.ok(fl.j(r)->>'status' = 'approved'
                and (select relation = 'grandparent' and not can_register and not can_pay and not receives_emails
                       from public.athlete_guardian_links where profile_id = fl.get('GP') and status = 'active'),
                'staff approve "this child only" with chosen permissions (' || r || ')');
  perform fl.ok(not exists (select 1 from public.participant_bookers where profile_id = fl.get('GP')),
                'no booking identity without can_register');
  r := fl.as_('GP', format('select public.third_party_camp_hold(%L, %L)::text',
              fl.hold(fl.get('K1'), '00000000-0000-0000-0000-0000000fa0e1', 'synthetic-token-gp-0123456789abcdef0123456789'), gen_random_uuid()));
  perform fl.ok(r like 'ERR:ATHLETE_NOT_FOUND%', 'a view-only linker cannot book (' || r || ')');
end $$;

-- ===========================================================================
-- C. Booking as a linker: guardian consent, invoice to the linker
-- ===========================================================================
do $$
declare r text; v jsonb; v_req uuid; v_reg uuid; v_keys jsonb; n_before int;
begin
  perform fl.ok(exists (select 1 from public.participant_bookers where profile_id = fl.get('AU') and athlete_id = fl.get('K1') and scope = 'linked'),
                'booking identity created for a linker with can_register');
  perform fl.ok(fl.as_('AU', 'select public.booker_participants()::text') = 'OK:[]',
                'the linked child is not repeated under "someone else"');
  select count(*) into n_before from public.invoices where family_id = fl.get('F');
  r := fl.as_('AU', format('select public.third_party_camp_hold(%L, %L)::text',
              fl.hold(fl.get('K1'), '00000000-0000-0000-0000-0000000fa0e1', 'synthetic-token-au-0123456789abcdef0123456789'), gen_random_uuid()));
  v := fl.j(r);
  v_reg := (v->>'registration_id')::uuid;
  v_req := (v->>'consent_request_id')::uuid;
  perform fl.ok(v_reg is not null and v->>'status' = 'awaiting_consent', 'linker camp booking held awaiting guardian consent (' || r || ')');
  perform fl.ok((select existing_child and guardian_email = 'fl-guardian@example.test' and relation = 'nephew_niece'
                   from public.guardian_consent_requests where id = v_req),
                'consent request addressed to the family''s primary guardian (existing child)');
  perform fl.ok((select status::text || '/' || guardian_consent_status || '/' || coalesce(invoice_id::text, 'none') || '/' || registered_by::text
                   from public.registrations where id = v_reg) = 'pending/awaiting/none/' || fl.txt('AU'),
                'held place: pending, awaiting consent, no invoice, registered by the linker');
  select coalesce(jsonb_agg(f->>'key'), '[]'::jsonb) into v_keys
    from public.guardian_consent_requests g, jsonb_array_elements(g.consent_forms) f where g.id = v_req;
  r := fl.as_('AU', format('select public.guardian_consent_accept(%L, %L)::text',
              fl.hash('synthetic-token-au-0123456789abcdef0123456789'), jsonb_build_object('accepted_keys', v_keys)));
  perform fl.ok(r like 'ERR:BOOKER_CANNOT_CONSENT%', 'the linker cannot give the guardian consent (' || r || ')');
  r := fl.as_('OUT', format('select public.guardian_consent_accept(%L, %L)::text',
              fl.hash('synthetic-token-au-0123456789abcdef0123456789'), jsonb_build_object('accepted_keys', v_keys)));
  perform fl.ok(r like 'ERR:NOT_GUARDIAN%', 'an outsider cannot consent (' || r || ')');
  r := fl.as_('G', format('select public.guardian_consent_accept(%L, %L)::text',
              fl.hash('synthetic-token-au-0123456789abcdef0123456789'), jsonb_build_object('accepted_keys', v_keys)));
  perform fl.ok(fl.j(r)->>'ok' = 'true', 'the family guardian consents (' || r || ')');
  perform fl.ok((select i.payer_kind = 'other' and i.payer_profile_id = fl.get('AU') and i.total_chf = 250
                   from public.registrations g join public.invoices i on i.id = g.invoice_id where g.id = v_reg),
                'invoice addressed to the linker as payer (family billing untouched)');
  perform fl.ok(not exists (select 1 from public.family_members where profile_id = fl.get('AU')), 'consent grants the linker nothing more');
  perform fl.ok(fl.as_('AU', 'select count(*)::text from public.invoices where id = ''00000000-0000-0000-0000-0000000fa091''') = 'OK:0',
                'after booking the linker still cannot read the family invoice');
  -- A second hold stays pending (for the revocation test).
  r := fl.as_('AU', format('select public.third_party_camp_hold(%L, %L)::text',
              fl.hold(fl.get('K1'), '00000000-0000-0000-0000-0000000fa0e2', 'synthetic-token-au2-0123456789abcdef0123456789'), gen_random_uuid()));
  perform fl.put('REG2', (fl.j(r)->>'registration_id'));
  perform fl.put('REQ2', (fl.j(r)->>'consent_request_id'));
  perform fl.ok(fl.get('REG2') is not null, 'second hold placed (' || r || ')');
  -- A linker cannot book the sibling.
  r := fl.as_('AU', format('select public.third_party_camp_hold(%L, %L)::text',
              fl.hold(fl.get('K2'), '00000000-0000-0000-0000-0000000fa0e2', 'synthetic-token-au3-0123456789abcdef0123456789'), gen_random_uuid()));
  perform fl.ok(r like 'ERR:ATHLETE_NOT_FOUND%', 'linker cannot book the sibling (' || r || ')');
end $$;

-- ===========================================================================
-- D. Revocation is immediate
-- ===========================================================================
do $$
declare r text;
begin
  r := fl.as_('G2', format('select public.athlete_link_revoke(%L, null)::text', fl.get('LINK_AU')));
  perform fl.ok(r like 'ERR:NOT_FOUND%', 'another family cannot revoke');
  r := fl.as_('G', format('select public.athlete_link_revoke(%L, %L)::text', fl.get('LINK_AU'), 'Synthetic reason'));
  perform fl.ok(fl.j(r)->>'ok' = 'true', 'guardian revokes (' || r || ')');
  perform fl.ok(fl.as_('AU', format('select count(*)::text from public.athletes where id = %L', fl.get('K1'))) = 'OK:0',
                'after revocation: no access to the child');
  perform fl.ok(fl.as_('AU', 'select public.my_athletes()::text') = 'OK:[]', 'after revocation: My Athletes empty');
  perform fl.ok(not exists (select 1 from public.participant_bookers where profile_id = fl.get('AU')), 'booking identity removed');
  perform fl.ok((select status::text || '/' || guardian_consent_status from public.registrations where id = fl.get('REG2')) = 'cancelled/revoked'
                and (select status from public.guardian_consent_requests where id = fl.get('REQ2')) = 'revoked',
                'pending hold cancelled, place freed');
  r := fl.as_('AU', format('select public.third_party_camp_hold(%L, %L)::text',
              fl.hold(fl.get('K1'), '00000000-0000-0000-0000-0000000fa0e2', 'synthetic-token-au4-0123456789abcdef0123456789'), gen_random_uuid()));
  perform fl.ok(r like 'ERR:ATHLETE_NOT_FOUND%', 'after revocation: cannot book (' || r || ')');
  perform fl.ok(exists (select 1 from public.audit_logs where action = 'participant.link.revoked' and target_id = fl.get('LINK_AU')
                         and new_data->>'via' = 'guardian'), 'revocation audited');
  perform fl.ok((select status = 'revoked' and revoked_by = fl.get('G') and revoke_reason = 'Synthetic reason'
                   from public.athlete_guardian_links where id = fl.get('LINK_AU')), 'link kept as history (revoked, not deleted)');
  -- The linked adult may also leave on their own.
  r := fl.as_('GP', format('select public.athlete_link_revoke(%L, null)::text',
              (select id from public.athlete_guardian_links where profile_id = fl.get('GP') and status = 'active')));
  perform fl.ok(fl.j(r)->>'ok' = 'true' and fl.as_('GP', format('select count(*)::text from public.athletes where id = %L', fl.get('K1'))) = 'OK:0',
                'a linker can end their own link');
end $$;

-- ===========================================================================
-- E. "Whole family" unchanged; supersedes a per-child link
-- ===========================================================================
do $$
declare r text;
begin
  -- P2 first gets a per-child link on K1, then whole-family access via K2.
  r := fl.as_('G', $q$select public.participant_link_decide('00000000-0000-0000-0000-0000000fa0b4', 'approve', '{"scope":"athlete"}'::jsonb, null)::text$q$);
  perform fl.ok(fl.j(r)->>'scope' = 'athlete', 'per-child link for the second parent');
  r := fl.as_('G', $q$select public.participant_link_decide('00000000-0000-0000-0000-0000000fa0b2', 'approve', '{"can_pay":true}'::jsonb, null)::text$q$);
  perform fl.ok(fl.j(r)->>'status' = 'approved' and fl.j(r)->>'scope' = 'family', 'default scope is the whole family (' || r || ')');
  perform fl.ok(exists (select 1 from public.family_members where family_id = fl.get('F') and profile_id = fl.get('P2') and can_pay and not is_primary),
                'whole family: family_members row with the chosen permissions');
  perform fl.ok(fl.as_('P2', format('select count(*)::text from public.athletes where id in (%L, %L)', fl.get('K1'), fl.get('K2'))) = 'OK:2',
                'whole family: sees every child of the family');
  perform fl.ok(not exists (select 1 from public.athlete_guardian_links where profile_id = fl.get('P2') and status = 'active')
                and exists (select 1 from public.athlete_guardian_links where profile_id = fl.get('P2') and revoke_reason = 'superseded by family access'),
                'the per-child link is superseded (kept as history)');
  perform fl.ok((select count(*) from jsonb_array_elements(fl.j(fl.as_('P2', 'select public.my_athletes()::text'))) e where e->>'kind' = 'child') = 2,
                'whole family: My Athletes lists both children as family children');
end $$;

-- ===========================================================================
-- F. Manual registrations (data check)
-- ===========================================================================
do $$
declare r text; v_flag uuid;
begin
  r := fl.as_('ADMIN', 'select public.athlete_data_check()::text');
  perform fl.ok(r like 'OK:%', 'data check runs (' || r || ')');
  select id into v_flag from public.data_review_flags where entity_id = fl.get('K5') and reason_code = 'NO_GUARDIAN_LOGIN' and resolved_at is null;
  perform fl.ok(v_flag is not null and (select (details->>'informational')::boolean and (details->>'has_contact_email')::boolean
                                          from public.data_review_flags where id = v_flag),
                'staff-created athlete: informational NO_GUARDIAN_LOGIN (contact e-mail known)');
  perform fl.ok(not exists (select 1 from public.data_review_flags where entity_id = fl.get('K5') and reason_code = 'ATHLETE_WITHOUT_GUARDIAN'),
                'staff-created athlete: not raised as a problem');
  perform fl.ok(not exists (select 1 from public.data_review_flags where entity_id = fl.get('K1') and reason_code in ('NO_GUARDIAN_LOGIN', 'ATHLETE_WITHOUT_GUARDIAN')),
                'athlete with a guardian login: no flag');
  -- Dismiss -> never raised again.
  update public.data_review_flags set resolved_at = now(), resolved_by = fl.get('ADMIN'), resolution_note = 'dismissed' where id = v_flag;
  perform fl.as_('ADMIN', 'select public.athlete_data_check()::text');
  perform fl.as_('ADMIN', 'select public.attendance_review_flags(''00000000-0000-0000-0000-000000000001'')::text');
  perform fl.ok((select count(*) from public.data_review_flags where entity_id = fl.get('K5') and reason_code in ('NO_GUARDIAN_LOGIN', 'ATHLETE_WITHOUT_GUARDIAN')) = 1,
                'dismissed suggestion is not raised again by later checks');
  -- K6 gets a login later -> its open suggestion resolves itself.
  perform fl.ok(exists (select 1 from public.data_review_flags where entity_id = fl.get('K6') and reason_code = 'NO_GUARDIAN_LOGIN' and resolved_at is null),
                'second staff-created athlete: open suggestion');
  insert into public.family_members (family_id, profile_id, relation, is_primary)
  values ('00000000-0000-0000-0000-0000000fa066', fl.get('OUT'), 'guardian', true);
  perform fl.as_('ADMIN', 'select public.athlete_data_check()::text');
  perform fl.ok((select resolution_note from public.data_review_flags where entity_id = fl.get('K6') and reason_code = 'NO_GUARDIAN_LOGIN') = 'guardian login linked',
                'suggestion resolved automatically once a guardian login exists');
  -- An open legacy ATHLETE_WITHOUT_GUARDIAN on K5-like data (fresh athlete) for the reclassification.
  insert into public.families (id, org_id, name, contact_email) values
    ('00000000-0000-0000-0000-0000000fa067', '00000000-0000-0000-0000-000000000001', 'Synthetic FL Legacy', null);
  insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, gender, status) values
    ('00000000-0000-0000-0000-0000000fa077', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa067', 'Synthetic', 'Fllegacy', '2014-02-02', 'male', 'active');
  insert into public.data_review_flags (id, org_id, entity_table, entity_id, reason_code, details) values
    ('00000000-0000-0000-0000-0000000fa0d1', '00000000-0000-0000-0000-000000000001', 'athletes', '00000000-0000-0000-0000-0000000fa077',
     'ATHLETE_WITHOUT_GUARDIAN', '{"source":"data_check"}');
end $$;

-- Re-run the migration: reclassifies the open legacy flag (history kept) and is idempotent.
\set QUIET on
\i supabase/migrations/20250420106300_flexible_links_finance_scope.sql
\i supabase/migrations/20250420106300_flexible_links_finance_scope.sql
-- Later migrations that replace functions of 106300 are re-applied after it (as in the real order).
\i supabase/migrations/20250420106400_link_request_relations.sql
\i supabase/migrations/20250420106400_link_request_relations.sql
\i supabase/migrations/20250420106500_relative_invites_carer_consent.sql
\i supabase/migrations/20250420106500_relative_invites_carer_consent.sql
\i supabase/migrations/20250420106600_carer_consent_default.sql
\set QUIET off
do $$
begin
  perform fl.ok((select resolved_at is not null and resolution_note like 'Reclassified:%' from public.data_review_flags
                  where id = '00000000-0000-0000-0000-0000000fa0d1'),
                'legacy ATHLETE_WITHOUT_GUARDIAN resolved with a note (not deleted)');
  perform fl.ok((select count(*) from public.data_review_flags where entity_id = '00000000-0000-0000-0000-0000000fa077'
                   and reason_code = 'NO_GUARDIAN_LOGIN' and resolved_at is null
                   and details->>'previous_flag_id' = '00000000-0000-0000-0000-0000000fa0d1'
                   and (details->>'has_contact_email')::boolean = false) = 1,
                'reclassified into one informational NO_GUARDIAN_LOGIN (re-run adds nothing)');
  perform fl.ok((select count(*) from public.athlete_guardian_links) = 3, 'migration re-run keeps every link');
end $$;

-- ===========================================================================
-- G. Finance: billing columns only
-- ===========================================================================
do $$
declare r text;
begin
  perform fl.ok(fl.as_('FIN', format('select count(*)::text from public.athletes where id = %L', fl.get('K1'))) = 'OK:0',
                'finance cannot select the athletes table (sports / profile columns)');
  perform fl.ok(fl.as_('FIN', format('select height_cm::text from public.athletes where id = %L', fl.get('K1'))) = 'OK:<null>',
                'finance cannot read height');
  perform fl.ok(fl.as_('FIN', format('select count(*)::text from public.athlete_medical where athlete_id = %L', fl.get('K1'))) = 'OK:0',
                'finance cannot read medical data');
  perform fl.ok(fl.as_('FIN', format('select first_name || '' '' || last_name || ''/'' || family_id::text || ''/'' || status from public.billing_athletes where id = %L', fl.get('K1')))
                = 'OK:Synthetic Flone/' || fl.txt('F') || '/active',
                'finance reads the billing name, family and status');
  r := fl.as_('FIN', format('select dob::text from public.billing_athletes where id = %L', fl.get('K1')));
  perform fl.ok(r like 'ERR:%column%', 'billing view has no DOB (' || r || ')');
  r := fl.as_('FIN', format('select school from public.billing_athletes where id = %L', fl.get('K1')));
  perform fl.ok(r like 'ERR:%column%', 'billing view has no school / sports / profile fields');
  perform fl.ok(fl.as_('FIN', 'select count(*)::text from public.invoices where id = ''00000000-0000-0000-0000-0000000fa091''') = 'OK:1',
                'finance still reads invoices');
  perform fl.ok(fl.as_('G', 'select count(*)::text from public.billing_athletes') = 'OK:0', 'a guardian gets nothing from the billing view');
  r := fl.as_('ADMIN', format('select height_cm::text || ''/'' || school from public.athletes where id = %L', fl.get('K1')));
  perform fl.ok(r = 'OK:152.0/Synthetic School', 'admins keep full athlete access (' || r || ')');
  r := fl.as_('FIN', format($q$update public.athletes set height_cm = 200 where id = %L returning id::text$q$, fl.get('K1')));
  perform fl.ok((r = 'OK:<null>' or r like 'ERR:%') and (select height_cm from public.athletes where id = fl.get('K1')) = 152,
                'finance cannot write profile fields (' || r || ')');
  r := fl.as_('FIN', format($q$select array_length(public.athlete_sponsorship_set(%L, null, '{"sponsorship_kind":"partial","sponsorship_percent":30}'::jsonb), 1)::text$q$, fl.get('K1')));
  perform fl.ok(r = 'OK:1' and (select sponsorship_percent from public.athletes where id = fl.get('K1')) = 30,
                'finance sets a sponsorship through the RPC (' || r || ')');
  r := fl.as_('G', format($q$select public.athlete_sponsorship_set(%L, null, '{"sponsorship_kind":"full"}'::jsonb)::text$q$, fl.get('K1')));
  perform fl.ok(r like 'ERR:NOT_AUTHORIZED%', 'a guardian cannot use the sponsorship RPC');
end $$;

-- ===========================================================================
-- H. Cross-tenant denial
-- ===========================================================================
do $$
declare r text;
begin
  perform fl.ok(fl.as_('BA', 'select count(*)::text from public.athlete_guardian_links') = 'OK:0', 'org B admin reads no link of org A');
  r := fl.as_('BA', format('select public.athlete_links_for(%L)::text', fl.get('K1')));
  perform fl.ok(r like 'ERR:NOT_FOUND%', 'org B admin cannot list org A links');
  r := fl.as_('BA', format('select public.athlete_link_revoke(%L, null)::text', (select id from public.athlete_guardian_links limit 1)));
  perform fl.ok(r like 'ERR:NOT_FOUND%', 'org B admin cannot revoke an org A link');
  r := fl.as_('BA', format($q$select public.athlete_link_update(%L, '{"can_see_medical":true}'::jsonb)::text$q$, (select id from public.athlete_guardian_links limit 1)));
  perform fl.ok(r like 'ERR:NOT_FOUND%', 'org B admin cannot change an org A link');
  r := fl.as_('BA', $q$select public.participant_link_decide('00000000-0000-0000-0000-0000000fa0b1', 'approve', '{"scope":"athlete"}'::jsonb, null)::text$q$);
  perform fl.ok(r like 'ERR:NOT_FOUND%', 'org B admin cannot decide an org A link request');
  perform fl.ok(fl.as_('BA', 'select public.athlete_links_mine_to_manage()::text') = 'OK:[]', 'org B admin: no org A links to manage');
  perform fl.ok(fl.as_('BA', format('select count(*)::text from public.billing_athletes where id = %L', fl.get('K1'))) = 'OK:0'
                and fl.as_('BA', format('select count(*)::text from public.billing_athletes where id = %L', fl.get('BK'))) = 'OK:1',
                'billing view: own club only');
  r := fl.as_('BA', format($q$select public.athlete_sponsorship_set(%L, null, '{"sponsorship_kind":"full"}'::jsonb)::text$q$, fl.get('K1')));
  perform fl.ok(r = 'OK:{}', 'sponsorship RPC cannot touch another club''s athlete (' || r || ')');
  perform fl.ok(fl.as_('BA', format('select public.athlete_link_can(%L, ''view'')::text', fl.get('K1'))) = 'OK:false', 'athlete_link_can false across clubs');
  -- A linker whose current club is another one loses the access there.
  insert into public.athlete_guardian_links (org_id, athlete_id, profile_id, relation)
  values ('00000000-0000-0000-0000-000000000001', fl.get('K3'), fl.get('BA'), 'family_friend');
  perform fl.ok(fl.as_('BA', format('select count(*)::text from public.athletes where id = %L', fl.get('K3'))) = 'OK:0'
                and fl.as_('BA', 'select public.my_athletes()::text') not like '%' || fl.txt('K3') || '%',
                'a link only works in its own club (current club B sees nothing of club A)');
  -- Writes only through the RPCs.
  r := fl.as_('G', format($q$insert into public.athlete_guardian_links (org_id, athlete_id, profile_id) values ('00000000-0000-0000-0000-000000000001', %L, %L) returning id::text$q$,
              fl.get('K1'), fl.get('OUT')));
  perform fl.ok(r like 'ERR:%', 'no direct insert into athlete_guardian_links (' || r || ')');
  r := fl.as_('ADMIN', format($q$delete from public.athlete_guardian_links where profile_id = %L returning id::text$q$, fl.get('AU')));
  perform fl.ok(r = 'OK:<null>' or r like 'ERR:%', 'no direct delete (history kept)');
  perform fl.ok(fl.run_as(null, format('select public.athlete_link_can(%L, ''view'')::text', fl.get('K1'))) like 'ERR:%', 'anon has no EXECUTE');
end $$;

-- 20250420106400: relatives name their relation; a per-child approval keeps it.
do $$
declare r text;
begin
  insert into public.athlete_link_requests (id, org_id, athlete_id, requester_profile_id, relation) values
    ('00000000-0000-0000-0000-0000000fa0b9', '00000000-0000-0000-0000-000000000001', fl.get('K2'), fl.get('GP'), 'aunt_uncle');
  perform fl.ok(true, 'a link request can name an aunt / uncle relation');
  r := fl.as_('G', $q$select public.participant_link_decide('00000000-0000-0000-0000-0000000fa0b9', 'approve', '{"scope":"athlete"}'::jsonb, null)::text$q$);
  perform fl.ok(fl.j(r)->>'scope' = 'athlete'
                and (select relation from public.athlete_guardian_links where athlete_id = fl.get('K2') and profile_id = fl.get('GP') and status = 'active') = 'aunt_uncle',
                'per-child approval keeps the requested relation (aunt / uncle) (' || r || ' req=' || (select relation from public.athlete_link_requests where id = '00000000-0000-0000-0000-0000000fa0b9') || ' rel=' || coalesce((select string_agg(relation || ':' || status || ':' || coalesce(link_request_id::text,'-'), ',') from public.athlete_guardian_links where athlete_id = fl.get('K2') and profile_id = fl.get('GP')), 'none') || ')');
  begin
    insert into public.athlete_link_requests (org_id, athlete_id, requester_profile_id, relation)
    values ('00000000-0000-0000-0000-000000000001', fl.get('K2'), fl.get('GP'), 'cousin_of_a_friend');
    perform fl.ok(false, 'unknown relation refused');
  exception when check_violation then perform fl.ok(true, 'unknown relation refused');
  end;
end $$;
