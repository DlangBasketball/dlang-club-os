-- ============================================================================
-- Camp age approval suite (migration 20250420105100_camp_age_approval.sql)
--
--   1. Age on the first day (6, 7, 8 on day 1, the day before the 8th
--      birthday, 5) and the band classification.
--   2. Band settings: off by default; a band reaching min_age is refused.
--   3. Submit (service role only): pending_approval, no invoice, not counted
--      in capacity; replay with the same request id; duplicate refused;
--      ages outside the band refused; other org's family refused.
--   4. Direct registration of a child in / below the band is refused.
--   5. Visibility: the guardian sees only their own child's request; another
--      family and another org see nothing.
--   6. Guards: guardian / finance cannot approve by editing the row.
--   7. Decisions: admin only (finance, guardian, other org refused); full
--      camp stays pending with the reason; approve -> same row pending with
--      one camp invoice; replay / double click never duplicates; concurrent
--      approvals for the last place (dblink): exactly one wins.
--   8. Payment in full -> confirmed (on the confirmed roster).
--   9. Decline with a message; re-apply after a decline; withdraw.
--  10. Free camp week: approval confirms at once, no invoice.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, guardian …f4 of
-- family …061). Org B …0002 (seed_tenants.sql). SYNTHETIC DATA ONLY.
-- Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema ca;
grant usage on schema ca to authenticated, anon, service_role;
create table ca.ctx (k text primary key, v text);
grant all on ca.ctx to authenticated, anon, service_role;

create function ca.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function ca.put(p_k text, p_v text) returns void language sql as $$
  insert into ca.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function ca.get(p_k text) returns uuid language sql stable as $$ select v::uuid from ca.ctx where k = p_k $$;
create function ca.txt(p_k text) returns text language sql stable as $$ select v from ca.ctx where k = p_k $$;
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
create function ca.run_svc(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    execute p_sql into v_res;
    return 'OK:' || coalesce(v_res, '<null>');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;
grant execute on all functions in schema ca to authenticated, anon, service_role;

-- Fixtures -----------------------------------------------------------------------
-- First day of the camp week: 30 days from today (registration open).
select ca.put('start', to_char(current_date + 30, 'YYYY-MM-DD'));

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000ca0b1', 'ca-guardian-b@example.test'),
  ('b0000000-0000-0000-0000-0000000ca0f1', 'ca-admin-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Guardian B'
 where id = '00000000-0000-0000-0000-0000000ca0b1';
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id = 'b0000000-0000-0000-0000-0000000ca0f1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ca0b1', 'parent'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000ca0f1', 'admin');

insert into public.families (id, org_id, name, contact_email) values
  ('00000000-0000-0000-0000-0000000ca061', '00000000-0000-0000-0000-000000000001', 'Synthetic Family B', 'family-b@example.test'),
  ('b0000000-0000-0000-0000-0000000ca061', '10000000-0000-0000-0000-000000000002', 'Synthetic Other Club Family', null);
insert into public.family_members (family_id, profile_id, relation) values
  ('00000000-0000-0000-0000-0000000ca061', '00000000-0000-0000-0000-0000000ca0b1', 'guardian');

do $$
declare s date := ca.txt('start')::date;
begin
  insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, status) values
    ('00000000-0000-0000-0000-0000000ca006', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000061', 'Synthetic', 'Six',      (s - interval '6 years 2 months')::date, 'active'),
    ('00000000-0000-0000-0000-0000000ca007', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000061', 'Synthetic', 'Seven',    (s - interval '7 years 5 months')::date, 'active'),
    ('00000000-0000-0000-0000-0000000ca008', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000061', 'Synthetic', 'EightDay1', (s - interval '8 years')::date, 'active'),
    ('00000000-0000-0000-0000-0000000ca005', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000061', 'Synthetic', 'Five',     (s - interval '5 years 3 months')::date, 'active'),
    ('00000000-0000-0000-0000-0000000ca010', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000061', 'Synthetic', 'Ten',      (s - interval '10 years')::date, 'active'),
    ('00000000-0000-0000-0000-0000000ca107', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ca061', 'Synthetic', 'BSeven',   (s - interval '7 years 1 month')::date, 'active'),
    ('00000000-0000-0000-0000-0000000ca106', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ca061', 'Synthetic', 'BSix',     (s - interval '6 years 6 months')::date, 'active'),
    ('b0000000-0000-0000-0000-0000000ca007', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000ca061', 'Synthetic', 'OtherSeven', (s - interval '7 years 2 months')::date, 'active');

  insert into public.programs (id, org_id, slug, name, kind, price_chf, is_public, is_active, status, currency, min_age, max_age)
  values ('00000000-0000-0000-0000-0000000ca041', '00000000-0000-0000-0000-000000000001', 'ca-camp', 'Synthetic Approval Camp',
          'camp', 0, true, true, 'published', 'CHF', 8, 14);
  insert into public.camp_editions (id, org_id, program_id, name, starts_on, ends_on, capacity, status) values
    ('00000000-0000-0000-0000-0000000ca0e1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ca041', 'Week A', s, s + 4, 2, 'published'),
    ('00000000-0000-0000-0000-0000000ca0e2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ca041', 'Week B', s + 7, s + 11, null, 'published'),
    ('00000000-0000-0000-0000-0000000ca0e3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ca041', 'Week C', s + 14, s + 18, 1, 'published');
  insert into public.camp_age_groups (id, org_id, program_id, label, min_age, max_age) values
    ('00000000-0000-0000-0000-0000000ca0a1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ca041', '8-14', 8, 14);
  insert into public.camp_price_options (id, org_id, program_id, edition_id, label, days_count, includes_lunch, price) values
    ('00000000-0000-0000-0000-0000000ca0c1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ca041', null, 'Full week', 5, true, 300),
    ('00000000-0000-0000-0000-0000000ca0c2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ca041', '00000000-0000-0000-0000-0000000ca0e2', 'Free week', 5, true, 0);
end $$;

create function ca.days(p_edition uuid) returns jsonb language sql stable as $$
  select jsonb_agg(to_char(d, 'YYYY-MM-DD') order by d)
    from public.camp_editions e, generate_series(e.starts_on, e.ends_on, interval '1 day') d where e.id = p_edition
$$;
create function ca.payload(p_athlete uuid, p_request uuid, p_edition uuid default '00000000-0000-0000-0000-0000000ca0e1',
                           p_family uuid default '00000000-0000-0000-0000-000000000061',
                           p_option uuid default '00000000-0000-0000-0000-0000000ca0c1') returns jsonb language sql stable as $$
  select jsonb_build_object(
    'program_id', '00000000-0000-0000-0000-0000000ca041', 'edition_id', p_edition, 'family_id', p_family,
    'registered_by', '00000000-0000-0000-0000-0000000000f4', 'request_id', p_request,
    'children', jsonb_build_array(jsonb_build_object('athlete_id', p_athlete, 'age_group_id', '00000000-0000-0000-0000-0000000ca0a1',
                                                     'price_option_id', p_option, 'days', ca.days(p_edition))),
    'consents', '[]'::jsonb)
$$;
create function ca.submit(p_athlete uuid, p_request uuid, p_edition uuid default '00000000-0000-0000-0000-0000000ca0e1',
                          p_family uuid default '00000000-0000-0000-0000-000000000061',
                          p_option uuid default '00000000-0000-0000-0000-0000000ca0c1') returns text language sql as $$
  select ca.run_svc(format('select public.camp_approval_submit(%L::jsonb)::text', ca.payload(p_athlete, p_request, p_edition, p_family, p_option)))
$$;
create function ca.decide(p_user uuid, p_reg uuid, p_decision text, p_note text default null) returns text language sql as $$
  select ca.run_as(p_user, format('select public.camp_approval_decide(%L::uuid, %L, %L, gen_random_uuid())::text', p_reg, p_decision, p_note))
$$;
grant execute on all functions in schema ca to authenticated, anon, service_role;

-- ===========================================================================
-- 1. Age on the first day + classification
-- ===========================================================================
do $$
declare s date := ca.txt('start')::date;
begin
  perform ca.ok(public.camp_age_on_start((s - interval '6 years 2 months')::date, s) = 6, 'age on start: 6');
  perform ca.ok(public.camp_age_on_start((s - interval '7 years 5 months')::date, s) = 7, 'age on start: 7');
  perform ca.ok(public.camp_age_on_start((s - interval '8 years')::date, s) = 8, 'age on start: 8th birthday exactly on day 1 -> 8');
  perform ca.ok(public.camp_age_on_start((s - interval '8 years' + interval '1 day')::date, s) = 7, 'age on start: 8th birthday the day after day 1 -> 7');
  perform ca.ok(public.camp_age_on_start((s - interval '5 years 3 months')::date, s) = 5, 'age on start: 5');
  perform ca.ok(public.camp_age_on_start('2020-02-29', '2027-02-28') = 6 and public.camp_age_on_start('2020-02-29', '2027-03-01') = 7,
                'age on start: 29 February birthday counts from 1 March');
  perform ca.ok(public.camp_age_on_start(null, s) is null, 'age on start: unknown date of birth -> null');
  -- Same fixed cases as tests/unit/camp-age-approval.test.ts (TS mirror).
  perform ca.ok(public.camp_age_on_start('2021-05-05', '2027-07-05') = 6 and public.camp_age_on_start('2020-02-05', '2027-07-05') = 7
            and public.camp_age_on_start('2019-07-05', '2027-07-05') = 8 and public.camp_age_on_start('2019-07-06', '2027-07-05') = 7
            and public.camp_age_on_start('2022-04-05', '2027-07-05') = 5, 'age on start: shared fixtures with the TS mirror');
  perform ca.ok(public.camp_age_band(8, 8, 14, 6, 7) = 'standard' and public.camp_age_band(7, 8, 14, 6, 7) = 'approval'
            and public.camp_age_band(6, 8, 14, 6, 7) = 'approval' and public.camp_age_band(5, 8, 14, 6, 7) = 'too_young'
            and public.camp_age_band(15, 8, 14, 6, 7) = 'too_old' and public.camp_age_band(null, 8, 14, 6, 7) = 'standard'
            and public.camp_age_band(7, 8, 14, null, null) = 'too_young' and public.camp_age_band(7, null, null, 6, 7) = 'standard',
                'band classification: standard / approval / too_young / too_old / unknown');
end $$;

-- ===========================================================================
-- 2. Band settings
-- ===========================================================================
do $$
declare v text;
begin
  perform ca.ok((select approval_age_min is null and approval_age_max is null from public.programs where id = '00000000-0000-0000-0000-000000000041'),
                'band is off by default on existing camps');
  v := ca.run_svc($q$update public.programs set approval_age_min = 6, approval_age_max = 8 where id = '00000000-0000-0000-0000-0000000ca041' returning 'x'$q$);
  perform ca.ok(v like 'ERR:%programs_approval_age_chk%', 'a band reaching min_age is refused (' || left(v, 60) || ')');
  v := ca.run_svc($q$update public.programs set approval_age_min = 7, approval_age_max = null where id = '00000000-0000-0000-0000-0000000ca041' returning 'x'$q$);
  perform ca.ok(v like 'ERR:%', 'a half-set band is refused');
  v := ca.submit('00000000-0000-0000-0000-0000000ca007', gen_random_uuid());
  perform ca.ok(v like 'ERR:%APPROVAL_NOT_ENABLED%', 'submit refused while the band is off (' || left(v, 60) || ')');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f1', $q$update public.programs set approval_age_min = 6, approval_age_max = 7 where id = '00000000-0000-0000-0000-0000000ca041' returning 'x'$q$);
  perform ca.ok(v = 'OK:x', 'admin sets the band 6-7 (' || v || ')');
  v := ca.run_as('b0000000-0000-0000-0000-0000000ca0f1', $q$update public.programs set approval_age_min = null, approval_age_max = null where id = '00000000-0000-0000-0000-0000000ca041' returning 'x'$q$);
  perform ca.ok(v = 'OK:<null>' and (select approval_age_min = 6 from public.programs where id = '00000000-0000-0000-0000-0000000ca041'),
                'other org admin cannot change the band (' || v || ')');
end $$;

-- ===========================================================================
-- 3. Submit
-- ===========================================================================
do $$
declare v text; v2 text; r jsonb; v_reg uuid; v_req uuid := gen_random_uuid();
begin
  perform ca.ok(not has_function_privilege('authenticated', 'public.camp_approval_submit(jsonb)', 'execute')
            and not has_function_privilege('anon', 'public.camp_approval_submit(jsonb)', 'execute'),
                'camp_approval_submit: no EXECUTE for anon / authenticated');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f4', format('select public.camp_approval_submit(%L::jsonb)::text', ca.payload('00000000-0000-0000-0000-0000000ca007', v_req)));
  perform ca.ok(v like 'ERR:%', 'camp_approval_submit refused for a signed-in guardian');

  v := ca.submit('00000000-0000-0000-0000-0000000ca007', v_req);
  perform ca.ok(v like 'OK:%', 'submit a 7-year-old (' || left(v, 100) || ')');
  r := substr(v, 4)::jsonb;
  v_reg := (r->'registration_ids'->>0)::uuid;
  perform ca.put('req7', v_reg::text);
  perform ca.ok((select status::text = 'pending_approval' and approval_status = 'pending' and invoice_id is null and approval_age = 7
                        and price_amount = 300 and price_currency = 'CHF' and approval_requested_at is not null
                   from public.registrations where id = v_reg),
                'request saved: pending_approval, no invoice, age 7, price snapshot 300 CHF');
  perform ca.ok(not exists (select 1 from public.invoices where registration_id = v_reg), 'no invoice for a request');
  perform ca.ok((select count(*) from public.registrations where camp_edition_id = '00000000-0000-0000-0000-0000000ca0e1'
                   and status in ('pending', 'confirmed')) = 0, 'a request does not count in capacity (pending + confirmed)');

  v2 := ca.submit('00000000-0000-0000-0000-0000000ca007', v_req);
  perform ca.ok(v2 like 'OK:%' and (substr(v2, 4)::jsonb->>'replayed')::boolean
            and substr(v2, 4)::jsonb->'registration_ids'->>0 = v_reg::text, 'retry with the same request id returns the same row');
  perform ca.ok((select count(*) from public.registrations where athlete_id = '00000000-0000-0000-0000-0000000ca007') = 1, 'no duplicate row after the retry');
  v := ca.submit('00000000-0000-0000-0000-0000000ca007', gen_random_uuid());
  perform ca.ok(v like 'ERR:%ALREADY_REQUESTED%', 'second request for the same child + week refused (' || left(v, 60) || ')');

  v := ca.submit('00000000-0000-0000-0000-0000000ca006', gen_random_uuid());
  perform ca.ok(v like 'OK:%' and (substr(v, 4)::jsonb->'ages'->>0)::int = 6, 'submit a 6-year-old');
  perform ca.put('req6', substr(v, 4)::jsonb->'registration_ids'->>0);
  v := ca.submit('00000000-0000-0000-0000-0000000ca008', gen_random_uuid());
  perform ca.ok(v like 'ERR:%NOT_APPROVAL_AGE%', '8 on the first day: standard flow, not an approval request');
  v := ca.submit('00000000-0000-0000-0000-0000000ca005', gen_random_uuid());
  perform ca.ok(v like 'ERR:%NOT_APPROVAL_AGE%', '5 on the first day: ineligible');
  v := ca.submit('00000000-0000-0000-0000-0000000ca107', gen_random_uuid());
  perform ca.ok(v like 'ERR:%ATHLETE_NOT_FOUND%', 'a child of another family cannot be submitted with this family');
  v := ca.submit('b0000000-0000-0000-0000-0000000ca007', gen_random_uuid(), '00000000-0000-0000-0000-0000000ca0e1', 'b0000000-0000-0000-0000-0000000ca061');
  perform ca.ok(v like 'ERR:%FAMILY_NOT_FOUND%', 'other org family refused on this club''s camp');
end $$;

-- ===========================================================================
-- 4. Direct registration of a child in / below the band
-- ===========================================================================
do $$
declare v text;
begin
  v := ca.run_svc($q$insert into public.registrations (org_id, athlete_id, program_id, status, camp_edition_id)
                     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ca106', '00000000-0000-0000-0000-0000000ca041', 'pending', '00000000-0000-0000-0000-0000000ca0e2') returning 'x'$q$);
  perform ca.ok(v like 'ERR:%APPROVAL_REQUIRED%', 'direct booking of a band child refused (' || left(v, 60) || ')');
  v := ca.run_svc($q$insert into public.registrations (org_id, athlete_id, program_id, status, camp_edition_id)
                     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ca005', '00000000-0000-0000-0000-0000000ca041', 'pending', '00000000-0000-0000-0000-0000000ca0e2') returning 'x'$q$);
  perform ca.ok(v like 'ERR:%AGE_OUT_OF_RANGE%', 'direct booking below the band refused');
  v := ca.run_svc($q$insert into public.registrations (org_id, athlete_id, program_id, status, camp_edition_id, approval_status)
                     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ca005', '00000000-0000-0000-0000-0000000ca041', 'pending', '00000000-0000-0000-0000-0000000ca0e2', 'approved') returning 'x'$q$);
  perform ca.ok(v like 'ERR:%USE_CAMP_APPROVAL%', 'a row cannot be inserted as approved');
end $$;

-- ===========================================================================
-- 5. Visibility (RLS)
-- ===========================================================================
do $$
declare v text;
begin
  v := ca.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select count(*)::text from public.registrations where id = %L$q$, ca.get('req7')));
  perform ca.ok(v = 'OK:1', 'guardian sees their own child''s request');
  v := ca.run_as('00000000-0000-0000-0000-0000000ca0b1', format($q$select count(*)::text from public.registrations where id in (%L, %L)$q$, ca.get('req7'), ca.get('req6')));
  perform ca.ok(v = 'OK:0', 'another family does not see it');
  v := ca.run_as('b0000000-0000-0000-0000-0000000ca0f1', $q$select count(*)::text from public.registrations where status = 'pending_approval'$q$);
  perform ca.ok(v = 'OK:0', 'another org admin sees no request');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.registrations where status = 'pending_approval'$q$);
  perform ca.ok(v = 'OK:2', 'club admin sees the queue (2)');
end $$;

-- ===========================================================================
-- 6. Guards: no approval by editing the row
-- ===========================================================================
do $$
declare v text;
begin
  v := ca.run_as('00000000-0000-0000-0000-0000000000f4', format($q$update public.registrations set approval_status = 'approved' where id = %L returning 'x'$q$, ca.get('req7')));
  perform ca.ok(v like 'ERR:%APPROVAL_LOCKED%', 'guardian cannot set approval_status (' || left(v, 60) || ')');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f4', format($q$update public.registrations set status = 'confirmed' where id = %L returning 'x'$q$, ca.get('req7')));
  perform ca.ok(v like 'ERR:%USE_CAMP_APPROVAL%', 'guardian cannot confirm a request');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f2', format($q$update public.registrations set status = 'pending' where id = %L returning 'x'$q$, ca.get('req7')));
  perform ca.ok(v like 'ERR:%USE_CAMP_APPROVAL%', 'finance cannot move a request into the booking flow');
  perform ca.ok((select status::text = 'pending_approval' from public.registrations where id = ca.get('req7')), 'request unchanged');
end $$;

-- ===========================================================================
-- 7. Decisions
-- ===========================================================================
do $$
declare v text; r jsonb; v_inv uuid; n int;
begin
  v := ca.decide('00000000-0000-0000-0000-0000000000f2', ca.get('req7'), 'approve');
  perform ca.ok(v like 'ERR:%NOT_AUTHORIZED%', 'finance cannot decide (' || left(v, 60) || ')');
  v := ca.decide('00000000-0000-0000-0000-0000000000f4', ca.get('req7'), 'approve');
  perform ca.ok(v like 'ERR:%NOT_AUTHORIZED%', 'guardian cannot decide');
  v := ca.decide('b0000000-0000-0000-0000-0000000ca0f1', ca.get('req7'), 'approve');
  perform ca.ok(v like 'ERR:%REQUEST_NOT_FOUND%', 'another org admin cannot decide');
  v := ca.run_as(null, format($q$select public.camp_approval_decide(%L::uuid, 'approve')::text$q$, ca.get('req7')));
  perform ca.ok(v like 'ERR:%', 'anonymous cannot decide');

  -- Fill week A (capacity 2) with two regular bookings.
  perform set_config('app.camp_pricing', 'on', false);
  insert into public.registrations (id, org_id, athlete_id, program_id, status, camp_edition_id) values
    ('00000000-0000-0000-0000-0000000ca201', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ca008', '00000000-0000-0000-0000-0000000ca041', 'pending', '00000000-0000-0000-0000-0000000ca0e1'),
    ('00000000-0000-0000-0000-0000000ca202', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ca010', '00000000-0000-0000-0000-0000000ca041', 'confirmed', '00000000-0000-0000-0000-0000000ca0e1');
  perform set_config('app.camp_pricing', 'off', false);
  perform ca.ok(true, '8 on day 1 books through the standard flow (row inserted)');

  v := ca.decide('00000000-0000-0000-0000-0000000000f1', ca.get('req7'), 'approve');
  r := substr(v, 4)::jsonb;
  perform ca.ok(v like 'OK:%' and not (r->>'decided')::boolean and r->>'reason' = 'EDITION_FULL' and (r->>'capacity')::int = 2,
                'full week: approval not applied, reason EDITION_FULL (' || left(v, 120) || ')');
  perform ca.ok((select status::text = 'pending_approval' and approval_status = 'pending' and invoice_id is null
                   from public.registrations where id = ca.get('req7')), 'full week: request stays pending, nothing changed');

  -- A place frees up.
  update public.registrations set status = 'cancelled' where id = '00000000-0000-0000-0000-0000000ca201';
  v := ca.decide('00000000-0000-0000-0000-0000000000f1', ca.get('req7'), 'approve', 'Welcome!');
  r := substr(v, 4)::jsonb;
  perform ca.ok(v like 'OK:%' and (r->>'decided')::boolean and r->>'status' = 'pending' and r->>'invoice_id' is not null,
                'approve: same row enters the booking flow awaiting payment (' || left(v, 140) || ')');
  v_inv := (r->>'invoice_id')::uuid;
  perform ca.put('inv7', v_inv::text);
  perform ca.ok((select status::text = 'pending' and approval_status = 'approved' and invoice_id = v_inv
                        and approval_decided_by = '00000000-0000-0000-0000-0000000000f1' and approval_decided_at is not null
                        and approval_note = 'Welcome!'
                   from public.registrations where id = ca.get('req7')), 'decision recorded (by, at, message), invoice linked');
  perform ca.ok((select activity = 'camp' and status::text = 'sent' and total_chf = 300 and currency = 'CHF'
                        and registration_id = ca.get('req7') and family_id = '00000000-0000-0000-0000-000000000061'
                   from public.invoices where id = v_inv), 'camp invoice issued (category camp, 300 CHF, family, registration)');
  perform ca.ok((select count(*) from public.invoice_items where invoice_id = v_inv) = 1, 'one invoice line');
  perform ca.ok(exists (select 1 from public.audit_logs where target_id = ca.get('req7') and action = 'camp.approval.approve'), 'approval audited');
  perform ca.ok((select count(*) from public.registrations where camp_edition_id = '00000000-0000-0000-0000-0000000ca0e1'
                   and status in ('pending', 'confirmed')) = 2, 'the approved child now holds a place (capacity 2/2)');

  -- Double click / retry.
  v := ca.decide('00000000-0000-0000-0000-0000000000f1', ca.get('req7'), 'approve');
  r := substr(v, 4)::jsonb;
  perform ca.ok(v like 'OK:%' and (r->>'replayed')::boolean and (r->>'invoice_id')::uuid = v_inv, 'second approve replays the first decision');
  select count(*) into n from public.invoices where registration_id = ca.get('req7');
  perform ca.ok(n = 1, 'still one invoice after the retry (' || n || ')');
  perform ca.ok((select count(*) from public.registrations where athlete_id = '00000000-0000-0000-0000-0000000ca007') = 1, 'still one registration');
  v := ca.decide('00000000-0000-0000-0000-0000000000f1', ca.get('req7'), 'decline');
  perform ca.ok(v like 'ERR:%ALREADY_DECIDED%', 'decline after approve refused');
end $$;

-- Concurrent approvals for the last place of week C (capacity 1): two sessions.
do $$
declare v text;
begin
  v := ca.submit('00000000-0000-0000-0000-0000000ca006', gen_random_uuid(), '00000000-0000-0000-0000-0000000ca0e3');
  perform ca.put('raceA', substr(v, 4)::jsonb->'registration_ids'->>0);
  v := ca.submit('00000000-0000-0000-0000-0000000ca107', gen_random_uuid(), '00000000-0000-0000-0000-0000000ca0e3', '00000000-0000-0000-0000-0000000ca061');
  perform ca.put('raceB', substr(v, 4)::jsonb->'registration_ids'->>0);
  perform ca.ok(ca.get('raceA') is not null and ca.get('raceB') is not null, 'two requests for the single place of week C');
end $$;

do $$
declare v_conn text; v_ok boolean := true; r1 text; r2 text; v_setup text;
begin
  begin
    create extension if not exists dblink;
    v_conn := format('dbname=%s host=localhost port=%s user=%s password=postgres', current_database(), current_setting('port'), current_user);
    perform dblink_connect('ca_c1', v_conn);
    perform dblink_connect('ca_c2', v_conn);
  exception when others then
    v_ok := false;
    raise notice 'INFO — concurrency check skipped (no second session: %)', sqlerrm;
  end;
  if v_ok then
    v_setup := 'set request.jwt.claim.sub = ''00000000-0000-0000-0000-0000000000f1''';
    perform dblink_exec('ca_c1', v_setup);
    perform dblink_exec('ca_c2', v_setup);
    perform dblink_exec('ca_c1', 'set role authenticated');
    perform dblink_exec('ca_c2', 'set role authenticated');
    perform dblink_exec('ca_c1', 'begin');
    select x into r1 from dblink('ca_c1', format('select public.camp_approval_decide(%L::uuid, ''approve'')::text', ca.get('raceA'))) as t(x text);
    -- Session 2 waits on the edition lock until session 1 commits.
    perform dblink_send_query('ca_c2', format('select public.camp_approval_decide(%L::uuid, ''approve'')::text', ca.get('raceB')));
    perform pg_sleep(0.3);
    perform dblink_exec('ca_c1', 'commit');
    select x into r2 from dblink_get_result('ca_c2') as t(x text);
    perform dblink_disconnect('ca_c1');
    perform dblink_disconnect('ca_c2');
    perform ca.ok((r1::jsonb->>'decided')::boolean and not (r2::jsonb->>'decided')::boolean and r2::jsonb->>'reason' = 'EDITION_FULL',
                  'concurrent approvals for the last place: the first wins, the second sees the week full');
    perform ca.ok((select count(*) from public.registrations where camp_edition_id = '00000000-0000-0000-0000-0000000ca0e3'
                     and status in ('pending', 'confirmed')) = 1, 'week C holds exactly its capacity (1)');
  end if;
end $$;

-- ===========================================================================
-- 8. Payment -> confirmed roster
-- ===========================================================================
do $$
declare v text;
begin
  v := ca.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.record_offline_payment(%L::uuid, 100, 'bank_transfer')::text$q$, ca.get('inv7')));
  perform ca.ok(v like 'OK:%', 'part payment recorded');
  perform ca.ok((select status::text = 'pending' from public.registrations where id = ca.get('req7')), 'part payment: still awaiting payment');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.record_offline_payment(%L::uuid, 200, 'bank_transfer')::text$q$, ca.get('inv7')));
  perform ca.ok(v like 'OK:%' and (select status::text = 'paid' from public.invoices where id = ca.get('inv7')), 'paid in full');
  perform ca.ok((select status::text = 'confirmed' and approval_status = 'approved' from public.registrations where id = ca.get('req7')),
                'paid in full -> confirmed, on the confirmed roster');
  perform ca.ok((select status::text = 'confirmed' from public.registrations where id = '00000000-0000-0000-0000-0000000ca202'),
                'regular camp registrations untouched');
end $$;

-- ===========================================================================
-- 8b. Ordinary camp place (8+): paid in full -> confirmed (20250420106100)
-- ===========================================================================
do $$
declare v text; v_inv uuid;
begin
  v := ca.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.create_manual_invoice(jsonb_build_object(
         'family_id', '00000000-0000-0000-0000-000000000061', 'description', 'Camp week A', 'activity', 'camp',
         'items', jsonb_build_array(jsonb_build_object('description', 'Camp', 'quantity', 1, 'unit_price_chf', 120))))::text$q$);
  v_inv := (substr(v, 4)::jsonb->>'invoice_id')::uuid;
  update public.invoices set status = 'sent', issued_at = now() where id = v_inv;
  perform set_config('app.camp_pricing', 'off', false);
  insert into public.registrations (id, org_id, athlete_id, program_id, status, camp_edition_id, invoice_id) values
    ('00000000-0000-0000-0000-0000000ca203', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ca008',
     '00000000-0000-0000-0000-0000000ca041', 'pending', '00000000-0000-0000-0000-0000000ca0e2', v_inv);
  perform set_config('app.camp_pricing', 'off', false);
  perform ca.ok((select status::text = 'pending' from public.registrations where id = '00000000-0000-0000-0000-0000000ca203'), 'ordinary place reserved until paid');
  v := ca.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.record_offline_payment(%L::uuid, 120, 'bank_transfer')::text$q$, v_inv));
  perform ca.ok(v like 'OK:%' and (select status::text = 'paid' from public.invoices where id = v_inv), 'ordinary place: invoice paid in full');
  perform ca.ok((select status::text = 'confirmed' and approval_status is null from public.registrations where id = '00000000-0000-0000-0000-0000000ca203'),
                'ordinary camp place: paid in full -> confirmed (on the confirmed roster)');
end $$;

-- ===========================================================================
-- 9. Decline, re-apply, withdraw
-- ===========================================================================
do $$
declare v text; v_reg uuid;
begin
  v := ca.submit('00000000-0000-0000-0000-0000000ca107', gen_random_uuid(), '00000000-0000-0000-0000-0000000ca0e1', '00000000-0000-0000-0000-0000000ca061');
  v_reg := (substr(v, 4)::jsonb->'registration_ids'->>0)::uuid;
  v := ca.decide('00000000-0000-0000-0000-0000000000f1', v_reg, 'decline', 'Sorry, this week is for older children.');
  perform ca.ok(v like 'OK:%' and substr(v, 4)::jsonb->>'approval_status' = 'declined', 'decline with a message');
  perform ca.ok((select status::text = 'cancelled' and approval_status = 'declined' and invoice_id is null
                        and approval_note = 'Sorry, this week is for older children.'
                   from public.registrations where id = v_reg), 'declined: cancelled, message stored, no invoice');
  v := ca.run_as('00000000-0000-0000-0000-0000000ca0b1', format($q$select approval_note from public.registrations where id = %L$q$, v_reg));
  perform ca.ok(v = 'OK:Sorry, this week is for older children.', 'the family sees the decision and its message');
  v := ca.decide('00000000-0000-0000-0000-0000000000f1', v_reg, 'decline');
  perform ca.ok(v like 'OK:%' and (substr(v, 4)::jsonb->>'replayed')::boolean, 'second decline replays');

  v := ca.submit('00000000-0000-0000-0000-0000000ca107', gen_random_uuid(), '00000000-0000-0000-0000-0000000ca0e1', '00000000-0000-0000-0000-0000000ca061');
  perform ca.ok(v like 'OK:%', 'the family may apply again after a decline');
  v_reg := (substr(v, 4)::jsonb->'registration_ids'->>0)::uuid;
  v := ca.run_as('00000000-0000-0000-0000-0000000ca0b1', format($q$update public.registrations set status = 'cancelled' where id = %L returning approval_status$q$, v_reg));
  perform ca.ok(v = 'OK:withdrawn', 'guardian withdraws the request (' || v || ')');
  v := ca.decide('00000000-0000-0000-0000-0000000000f1', v_reg, 'approve');
  perform ca.ok(v like 'ERR:%ALREADY_DECIDED%', 'a withdrawn request cannot be approved');
end $$;

-- ===========================================================================
-- 10. Free week: approval confirms at once
-- ===========================================================================
do $$
declare v text; v_reg uuid;
begin
  v := ca.submit('00000000-0000-0000-0000-0000000ca106', gen_random_uuid(), '00000000-0000-0000-0000-0000000ca0e2', '00000000-0000-0000-0000-0000000ca061',
                 '00000000-0000-0000-0000-0000000ca0c2');
  v_reg := (substr(v, 4)::jsonb->'registration_ids'->>0)::uuid;
  v := ca.decide('00000000-0000-0000-0000-0000000000f1', v_reg, 'approve');
  perform ca.ok(v like 'OK:%' and substr(v, 4)::jsonb->>'status' = 'confirmed' and substr(v, 4)::jsonb->>'invoice_id' is null,
                'free week: approved and confirmed at once, no invoice (' || left(v, 100) || ')');
end $$;
