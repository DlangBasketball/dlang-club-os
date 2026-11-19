-- ============================================================================
-- Camps + discounts (migration 20250420100100_camps_discounts.sql):
--   * demo seed supabase/seeds/camps_dlang_2027.sql is idempotent
--   * RLS per verb on camp_editions, camp_time_slots, camp_age_groups,
--     camp_price_options, discounts, applied_discounts — incl. cross-tenant
--     denial (read / insert / update / delete) for every new table
--   * register_camp(): service role only, capacity, window, days, age group,
--     price integrity, discount bounds, promo limits, guest family, invoice
--     lines (option + negative discount lines), price snapshot
--   * snapshot integrity: guardians / staff cannot rewrite the price; later
--     price changes do not touch existing registrations
--   * apply_manual_discount(): finance only, credit note on issued invoices
--
-- Fixtures (seed): org A …0001 (admin …f1, finance …f2, coach …f3, parent
-- …f4 = guardian of family …061 / athlete …071), family …062 (athletes …072,
-- …073). Org B = …0002; its admin + finance user is created here.
-- Every assertion prints PASS / FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

\i supabase/seeds/camps_dlang_2027.sql

create schema cd;
grant usage on schema cd to authenticated, anon;

create function cd.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

create function cd.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  if p is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
end $$;

create function cd.as_super() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- p_sql as user p (null = anon): 'OK:<first column>' or 'ERR:<message>'.
create function cd.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform cd.as_user(p);
    execute p_sql into v_res;
    perform cd.as_super();
    return 'OK:' || coalesce(v_res, '<null>');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    perform cd.as_super();
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;

-- p_sql as the service (no user): same result convention.
create function cd.run_svc(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform cd.as_super();
    execute p_sql into v_res;
    return 'OK:' || coalesce(v_res, '<null>');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;
grant execute on all functions in schema cd to authenticated, anon;

create table cd.ctx (k text primary key, v text);
grant all on cd.ctx to authenticated;
create function cd.get(p text) returns uuid language sql as $$ select v::uuid from cd.ctx where k = p $$;
grant execute on function cd.get(text) to authenticated, anon;

-- Org B admin + finance
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000b1', 'admin@riverside.test') on conflict do nothing;
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000000b1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', 'admin'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', 'finance')
on conflict do nothing;

-- ===========================================================================
-- 1. Demo seed: content and idempotency
-- ===========================================================================
do $$
declare v_prog uuid; n_ed int; n_opt int; n_grp int; n_slot int; n_disc int;
begin
  select id into v_prog from public.programs where slug = 'dlang-skills-technical-camp-2027';
  insert into cd.ctx values ('camp', v_prog::text);
  perform cd.ok(v_prog is not null, 'seed: camp programme created for org dlang');
  perform cd.ok((select kind::text = 'camp' and status = 'published' from public.programs where id = v_prog), 'seed: camp is a published programme of kind camp');
  select count(*) into n_ed from public.camp_editions where program_id = v_prog;
  select count(*) into n_opt from public.camp_price_options where program_id = v_prog;
  select count(*) into n_grp from public.camp_age_groups where program_id = v_prog;
  select count(*) into n_slot from public.camp_time_slots where program_id = v_prog;
  select count(*) into n_disc from public.discounts where org_id = '00000000-0000-0000-0000-000000000001';
  perform cd.ok(n_ed = 5 and n_opt = 8 and n_grp = 2 and n_slot = 2, format('seed: 5 editions, 8 options, 2 age groups, 2 slots (%s/%s/%s/%s)', n_ed, n_opt, n_grp, n_slot));
  perform cd.ok((select price from public.camp_price_options where program_id = v_prog and days_count = 5 and includes_lunch) = 550
            and (select price from public.camp_price_options where program_id = v_prog and days_count = 2 and not includes_lunch) = 200,
                'seed: reference prices (5 days with lunch 550, 2 days without 200)');
  perform cd.ok((select count(*) from public.camp_editions e join public.venues v on v.id = e.venue_id
                  where e.program_id = v_prog and v.name = 'Zurich International School') = 2,
                'seed: Zurich editions at Zurich International School');
  perform cd.ok((select count(*) from public.camp_editions where program_id = v_prog and status = 'published'
                  and registration_closes_at < starts_on::timestamptz) = 5, 'seed: editions published, registration closes before the start');
  perform cd.ok((select is_active from public.discounts where org_id = '00000000-0000-0000-0000-000000000001' and rule = 'sibling'), 'seed: sibling discount active');
  perform cd.ok(not (select is_active from public.discounts where org_id = '00000000-0000-0000-0000-000000000001' and rule = 'early_bird'), 'seed: early-bird example inactive');
  insert into cd.ctx values ('counts', format('%s/%s/%s/%s/%s', n_ed, n_opt, n_grp, n_slot, n_disc));
end $$;

\i supabase/seeds/camps_dlang_2027.sql

do $$
declare v_prog uuid := cd.get('camp');
begin
  perform cd.ok(format('%s/%s/%s/%s/%s',
      (select count(*) from public.camp_editions where program_id = v_prog),
      (select count(*) from public.camp_price_options where program_id = v_prog),
      (select count(*) from public.camp_age_groups where program_id = v_prog),
      (select count(*) from public.camp_time_slots where program_id = v_prog),
      (select count(*) from public.discounts where org_id = '00000000-0000-0000-0000-000000000001'))
    = (select v from cd.ctx where k = 'counts'), 'seed: second run changes nothing (idempotent)');
  perform cd.ok((select count(*) from public.programs where slug = 'dlang-skills-technical-camp-2027') = 1
            and (select count(*) from public.venues where org_id = '00000000-0000-0000-0000-000000000001' and name in ('Vieux Moulin', 'Zurich International School')) = 2,
                'seed: no duplicate programme / venues');
end $$;

-- A test edition relative to today (the seed's 2027 dates age out), with the
-- seed's camp-wide options, plus fixtures for the registration tests.
do $$
declare v_prog uuid := cd.get('camp'); v_ed uuid; v_d uuid;
begin
  insert into public.camp_editions (org_id, program_id, name, starts_on, ends_on, city, capacity, status, registration_opens_at, registration_closes_at)
  values ('00000000-0000-0000-0000-000000000001', v_prog, 'Test week', current_date + 40, current_date + 44, 'Lausanne', 4, 'published',
          now() - interval '1 day', now() + interval '30 days')
  returning id into v_ed;
  insert into cd.ctx values ('ed', v_ed::text);
  insert into cd.ctx select 'opt5l', id::text from public.camp_price_options where program_id = v_prog and days_count = 5 and includes_lunch;
  insert into cd.ctx select 'opt2n', id::text from public.camp_price_options where program_id = v_prog and days_count = 2 and not includes_lunch;
  insert into cd.ctx select 'g812', id::text from public.camp_age_groups where program_id = v_prog and min_age = 8;
  insert into cd.ctx select 'g1217', id::text from public.camp_age_groups where program_id = v_prog and min_age = 12;
  insert into cd.ctx select 'sib', id::text from public.discounts where org_id = '00000000-0000-0000-0000-000000000001' and rule = 'sibling';
  insert into public.discounts (org_id, name, kind, value, currency, scope, rule, code, max_redemptions, is_active)
  values ('00000000-0000-0000-0000-000000000001', 'Spring promo', 'fixed_amount', 30, 'CHF', 'camps', 'promo_code', 'spring27', 1, true)
  returning id into v_d;
  insert into cd.ctx values ('promo', v_d::text);
  insert into public.discounts (org_id, name, kind, value, scope, rule, is_active)
  values ('00000000-0000-0000-0000-000000000001', 'Goodwill', 'percent', 20, 'all', 'manual', true)
  returning id into v_d;
  insert into cd.ctx values ('manual', v_d::text);
  perform cd.ok((select code from public.discounts where id = cd.get('promo')) = 'SPRING27', 'discounts: promo code stored upper-case');
end $$;

-- ===========================================================================
-- 2. RLS: members read the camp, only admins write, discounts are staff-only
-- ===========================================================================
do $$
declare v text; v_prog uuid := cd.get('camp');
  a_admin uuid := '00000000-0000-0000-0000-0000000000f1'; a_fin uuid := '00000000-0000-0000-0000-0000000000f2';
  a_coach uuid := '00000000-0000-0000-0000-0000000000f3'; a_parent uuid := '00000000-0000-0000-0000-0000000000f4';
  t text;
begin
  foreach t in array array['camp_editions', 'camp_time_slots', 'camp_age_groups', 'camp_price_options'] loop
    v := cd.run_as(a_parent, format('select count(*) from public.%I', t));
    perform cd.ok(v <> 'OK:0' and v like 'OK:%', format('parent reads own club %s (%s)', t, v));
  end loop;
  v := cd.run_as(a_parent, 'select count(*) from public.discounts');
  perform cd.ok(v = 'OK:0', 'parent cannot read discounts / promo codes (' || v || ')');
  v := cd.run_as(a_coach, 'select count(*) from public.discounts');
  perform cd.ok(v = 'OK:0', 'coach cannot read discounts (' || v || ')');
  v := cd.run_as(a_fin, 'select count(*) from public.discounts');
  perform cd.ok(v = 'OK:4', 'finance reads the club discounts (' || v || ')');

  v := cd.run_as(a_parent, format($q$insert into public.camp_editions (org_id, program_id, starts_on, ends_on) values ('00000000-0000-0000-0000-000000000001', %L, current_date, current_date) returning id::text$q$, v_prog));
  perform cd.ok(v like 'ERR:%', 'parent cannot create an edition');
  v := cd.run_as(a_fin, format($q$insert into public.camp_price_options (org_id, program_id, label, days_count, price) values ('00000000-0000-0000-0000-000000000001', %L, 'x', 1, 10) returning id::text$q$, v_prog));
  perform cd.ok(v like 'ERR:%', 'finance cannot create a price option (admin only)');
  v := cd.run_as(a_admin, format($q$insert into public.camp_price_options (org_id, program_id, label, days_count, price) values ('00000000-0000-0000-0000-000000000001', %L, '1 day', 1, 120) returning id::text$q$, v_prog));
  perform cd.ok(v like 'OK:%', 'admin creates a price option');
  v := cd.run_as(a_admin, format($q$with u as (update public.camp_price_options set price = 130 where id = %L returning 1) select count(*) from u$q$, substr(v, 4)));
  perform cd.ok(v = 'OK:1', 'admin updates a price option');
  v := cd.run_as(a_parent, 'with u as (update public.camp_age_groups set label = ''x'' returning 1) select count(*) from u');
  perform cd.ok(v = 'OK:0', 'parent cannot update age groups');
  v := cd.run_as(a_parent, 'with u as (delete from public.camp_time_slots returning 1) select count(*) from u');
  perform cd.ok(v = 'OK:0', 'parent cannot delete time slots');
  v := cd.run_as(a_fin, $q$insert into public.discounts (org_id, name, kind, value, rule) values ('00000000-0000-0000-0000-000000000001', 'x', 'percent', 5, 'manual') returning id::text$q$);
  perform cd.ok(v like 'ERR:%', 'finance cannot create discounts (admin only)');
  v := cd.run_as(a_fin, $q$insert into public.applied_discounts (org_id, discount_id, rule, name, kind, value, amount, currency) select org_id, id, rule, name, kind, value, 1, 'CHF' from public.discounts where code = 'SPRING27' returning id::text$q$);
  perform cd.ok(v like 'ERR:%', 'applied_discounts: no direct inserts (RPC only)');
  v := cd.run_as(null, 'select count(*) from public.camp_editions');
  perform cd.ok(v like 'ERR:%' or v = 'OK:0', 'anon cannot read camp tables directly (' || v || ')');
  v := cd.run_as(a_admin, format($q$insert into public.camp_age_groups (org_id, program_id, label) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000043', 'x') returning id::text$q$));
  perform cd.ok(v like 'ERR:%', 'age groups only on programmes of kind camp (' || v || ')');
end $$;

-- ===========================================================================
-- 3. Cross-tenant denial for every new table (org B admin vs org A rows,
--    org A admin vs org B)
-- ===========================================================================
do $$
declare v text; t text; b uuid := 'b0000000-0000-0000-0000-0000000000b1'; a_admin uuid := '00000000-0000-0000-0000-0000000000f1';
  v_prog uuid := cd.get('camp');
begin
  foreach t in array array['camp_editions', 'camp_time_slots', 'camp_age_groups', 'camp_price_options', 'discounts', 'applied_discounts'] loop
    v := cd.run_as(b, format($q$select count(*) from public.%I where org_id = '00000000-0000-0000-0000-000000000001'$q$, t));
    perform cd.ok(v = 'OK:0', format('cross-tenant: org B admin reads no org A %s (%s)', t, v));
    v := cd.run_as(b, format($q$with u as (update public.%I set org_id = org_id where org_id = '00000000-0000-0000-0000-000000000001' returning 1) select count(*) from u$q$, t));
    perform cd.ok(v = 'OK:0', format('cross-tenant: org B admin updates no org A %s (%s)', t, v));
    v := cd.run_as(b, format($q$with u as (delete from public.%I where org_id = '00000000-0000-0000-0000-000000000001' returning 1) select count(*) from u$q$, t));
    perform cd.ok(v = 'OK:0', format('cross-tenant: org B admin deletes no org A %s (%s)', t, v));
  end loop;
  v := cd.run_as(b, format($q$insert into public.camp_editions (org_id, program_id, starts_on, ends_on) values ('00000000-0000-0000-0000-000000000001', %L, current_date, current_date) returning id::text$q$, v_prog));
  perform cd.ok(v like 'ERR:%', 'cross-tenant: org B admin cannot insert an edition into org A');
  v := cd.run_as(b, format($q$insert into public.camp_editions (org_id, program_id, starts_on, ends_on) values ('10000000-0000-0000-0000-000000000002', %L, current_date, current_date) returning id::text$q$, v_prog));
  perform cd.ok(v like 'ERR:%', 'cross-tenant: org B edition cannot hang off an org A camp (' || v || ')');
  v := cd.run_as(b, format($q$insert into public.camp_price_options (org_id, program_id, label, days_count, price) values ('00000000-0000-0000-0000-000000000001', %L, 'x', 1, 1) returning id::text$q$, v_prog));
  perform cd.ok(v like 'ERR:%', 'cross-tenant: org B admin cannot insert an org A price option');
  v := cd.run_as(b, format($q$insert into public.camp_age_groups (org_id, program_id, label) values ('00000000-0000-0000-0000-000000000001', %L, 'x') returning id::text$q$, v_prog));
  perform cd.ok(v like 'ERR:%', 'cross-tenant: org B admin cannot insert an org A age group');
  v := cd.run_as(b, format($q$insert into public.camp_time_slots (org_id, program_id, label, starts_at, ends_at) values ('00000000-0000-0000-0000-000000000001', %L, 'x', '09:00', '10:00') returning id::text$q$, v_prog));
  perform cd.ok(v like 'ERR:%', 'cross-tenant: org B admin cannot insert an org A time slot');
  v := cd.run_as(b, $q$insert into public.discounts (org_id, name, kind, value, rule) values ('00000000-0000-0000-0000-000000000001', 'x', 'percent', 5, 'manual') returning id::text$q$);
  perform cd.ok(v like 'ERR:%', 'cross-tenant: org B admin cannot insert an org A discount');
  v := cd.run_as(b, $q$select count(*) from public.discounts where code = 'SPRING27'$q$);
  perform cd.ok(v = 'OK:0', 'cross-tenant: org B cannot see org A promo codes');
  v := cd.run_as(a_admin, $q$insert into public.discounts (org_id, name, kind, value, rule) values ('10000000-0000-0000-0000-000000000002', 'x', 'percent', 5, 'manual') returning id::text$q$);
  perform cd.ok(v like 'ERR:%', 'cross-tenant: org A admin cannot insert into org B');
  v := cd.run_as(a_admin, format($q$with u as (update public.camp_editions set org_id = '10000000-0000-0000-0000-000000000002' where id = %L returning 1) select count(*) from u$q$, cd.get('ed')));
  perform cd.ok(v like 'ERR:%' or v = 'OK:0', 'cross-tenant: an edition cannot be moved to another org (' || v || ')');
end $$;

-- ===========================================================================
-- 4. register_camp(): grants, happy path (guest family, sibling discount)
-- ===========================================================================
do $$
declare v text;
begin
  perform cd.ok(not has_function_privilege('anon', 'public.register_camp(jsonb)', 'execute')
            and not has_function_privilege('authenticated', 'public.register_camp(jsonb)', 'execute'),
                'register_camp: no EXECUTE for anon / authenticated');
  v := cd.run_as('00000000-0000-0000-0000-0000000000f4', $q$select public.register_camp('{}'::jsonb)::text$q$);
  perform cd.ok(v like 'ERR:%', 'register_camp refused for a signed-in user (' || left(v, 60) || ')');
end $$;

create function cd.payload(p_children jsonb, p_extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'mode', 'public', 'program_id', cd.get('camp'), 'edition_id', cd.get('ed'),
    'parent', jsonb_build_object('name', 'Test Parent', 'email', 'guest.parent@example.test', 'phone', '+41 00 000 00 00',
                                 'emergency_name', 'Test Contact', 'emergency_phone', '+41 00 000 00 01'),
    'children', p_children, 'consents', '[]'::jsonb) || p_extra
$$;

create function cd.days(p_n int) returns jsonb language sql as $$
  select jsonb_agg(to_char(d, 'YYYY-MM-DD') order by d)
    from (select (current_date + 40 + g)::date d from generate_series(0, p_n - 1) g) x
$$;

do $$
declare v text; r jsonb; v_inv uuid; v_fam uuid; v_sib numeric;
begin
  v_sib := round(200 * 0.10, 2);
  v := cd.run_svc(format($q$select public.register_camp(%L::jsonb)::text$q$, cd.payload(jsonb_build_array(
    jsonb_build_object('first_name', 'Kid', 'last_name', 'One', 'dob', to_char(current_date - interval '10 years', 'YYYY-MM-DD'),
                       'age_group_id', cd.get('g812'), 'price_option_id', cd.get('opt5l'), 'days', cd.days(5), 'list_amount', 550, 'discounts', '[]'::jsonb),
    jsonb_build_object('first_name', 'Kid', 'last_name', 'Two', 'dob', to_char(current_date - interval '13 years', 'YYYY-MM-DD'),
                       'age_group_id', cd.get('g1217'), 'price_option_id', cd.get('opt2n'), 'days', cd.days(2), 'list_amount', 200,
                       'discounts', jsonb_build_array(jsonb_build_object('discount_id', cd.get('sib'), 'amount', v_sib)))))));
  perform cd.ok(v like 'OK:%', 'register_camp (service): public registration of two children (' || left(v, 120) || ')');
  r := substr(v, 4)::jsonb;
  v_inv := (r->>'invoice_id')::uuid;
  v_fam := (r->>'family_id')::uuid;
  insert into cd.ctx values ('inv1', v_inv::text), ('fam1', v_fam::text), ('reg1', r->'registration_ids'->>0), ('reg2', r->'registration_ids'->>1);
  perform cd.ok((select total_chf from public.invoices where id = v_inv) = 730, 'invoice total = 550 + 200 − 10% sibling = 730');
  perform cd.ok((select currency from public.invoices where id = v_inv) = 'CHF', 'invoice currency from the programme / club (CHF)');
  perform cd.ok((select count(*) from public.invoice_items where invoice_id = v_inv) = 3
            and (select count(*) from public.invoice_items where invoice_id = v_inv and amount_chf = -20) = 1,
                'invoice lines: two option lines + one negative discount line');
  perform cd.ok((select membership_status from public.families where id = v_fam) = 'guest', 'new family from a public camp page is a guest (non-member)');
  perform cd.ok(exists (select 1 from public.invitations where family_id = v_fam and status = 'pending' and role = 'parent'),
                'pending parent invitation for the guest family (account linking on sign-up)');
  perform cd.ok((select count(*) from public.applied_discounts where invoice_id = v_inv and amount = 20 and invoice_item_id is not null) = 1,
                'applied_discounts: sibling use recorded with its invoice line');
  perform cd.ok((select price_list_amount = 200 and price_discount_amount = 20 and price_amount = 180 and price_currency = 'CHF'
                        and array_length(camp_days, 1) = 2 and not camp_includes_lunch
                        and price_snapshot->>'option_label' is not null and jsonb_array_length(price_snapshot->'discounts') = 1
                   from public.registrations where id = cd.get('reg2')), 'registration price snapshot (list, discount, net, days, lunch, lines)');
  perform cd.ok((select camp_includes_lunch and price_amount = 550 from public.registrations where id = cd.get('reg1')), 'first child: full price, lunch');
  perform cd.ok(not exists (select 1 from public.registrations r join public.athlete_medical m on m.athlete_id = r.athlete_id
                             where r.id = cd.get('reg1') and r.notes is not null), 'no medical data copied into registrations');
end $$;

-- ===========================================================================
-- 5. register_camp(): refusals
-- ===========================================================================
create function cd.child(p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('first_name', 'Kid', 'last_name', 'X', 'dob', to_char(current_date - interval '10 years', 'YYYY-MM-DD'),
    'age_group_id', cd.get('g812'), 'price_option_id', cd.get('opt2n'), 'days', cd.days(2), 'list_amount', 200, 'discounts', '[]'::jsonb) || p_extra)
$$;

do $$
declare v text; n_inv int := (select count(*) from public.invoices);
begin
  v := cd.run_svc(format($q$select public.register_camp(%L::jsonb)::text$q$, cd.payload(cd.child('{"list_amount": 150}'))));
  perform cd.ok(v like '%PRICE_CHANGED%', 'price integrity: a client-side price is refused (' || left(v, 60) || ')');
  v := cd.run_svc(format($q$select public.register_camp(%L::jsonb)::text$q$, cd.payload(cd.child(jsonb_build_object('days', cd.days(3))))));
  perform cd.ok(v like '%INVALID_DAYS%', 'days: must be exactly the option''s day count');
  v := cd.run_svc(format($q$select public.register_camp(%L::jsonb)::text$q$, cd.payload(cd.child(jsonb_build_object('days', jsonb_build_array(to_char(current_date + 39, 'YYYY-MM-DD'), to_char(current_date + 40, 'YYYY-MM-DD')))))));
  perform cd.ok(v like '%INVALID_DAYS%', 'days: must be inside the edition');
  v := cd.run_svc(format($q$select public.register_camp(%L::jsonb)::text$q$, cd.payload(cd.child(jsonb_build_object('dob', to_char(current_date - interval '15 years', 'YYYY-MM-DD'))))));
  perform cd.ok(v like '%AGE_OUT_OF_RANGE%', 'age group: child too old for 8–12');
  v := cd.run_svc(format($q$select public.register_camp(%L::jsonb)::text$q$, cd.payload(cd.child(jsonb_build_object('discounts', jsonb_build_array(jsonb_build_object('discount_id', cd.get('sib'), 'amount', 50)))))));
  perform cd.ok(v like '%DISCOUNT_AMOUNT_INVALID%', 'discount amount above its nominal value is refused');
  v := cd.run_svc(format($q$select public.register_camp(%L::jsonb)::text$q$, cd.payload(cd.child(jsonb_build_object('discounts', jsonb_build_array(jsonb_build_object('discount_id', cd.get('manual'), 'amount', 10)))))));
  perform cd.ok(v like '%DISCOUNT_NOT_AVAILABLE%', 'manual discounts cannot be used in a self-service registration');
  v := cd.run_svc(format($q$select public.register_camp(%L::jsonb)::text$q$, cd.payload(cd.child(jsonb_build_object('discounts', jsonb_build_array(jsonb_build_object('discount_id', cd.get('promo'), 'amount', 30, 'code', 'WRONG')))))));
  perform cd.ok(v like '%PROMO_INVALID%', 'promo: the code must match');
  v := cd.run_svc(format($q$select public.register_camp(%L::jsonb)::text$q$, cd.payload(cd.child('{}'), jsonb_build_object('edition_id', (select id from public.camp_editions where program_id = cd.get('camp') and starts_on = '2027-04-05' and (select count(*) from public.camp_editions) > 0 limit 1), 'program_id', '00000000-0000-0000-0000-000000000041'))));
  perform cd.ok(v like 'ERR:%', 'edition must belong to the programme (' || left(v, 60) || ')');
  perform cd.ok((select count(*) from public.invoices) = n_inv, 'refused registrations leave no invoice behind');
end $$;

-- Promo usage limit (max 1): first use OK, second refused
do $$
declare v text;
begin
  v := cd.run_svc(format($q$select public.register_camp(%L::jsonb)::text$q$, cd.payload(cd.child(jsonb_build_object('first_name', 'Promo', 'discounts', jsonb_build_array(jsonb_build_object('discount_id', cd.get('promo'), 'amount', 30, 'code', 'spring27')))),
    '{"parent": {"name": "P2", "email": "p2@example.test", "phone": "000", "emergency_name": "E", "emergency_phone": "000"}}')));
  perform cd.ok(v like 'OK:%', 'promo: first use accepted (' || left(v, 80) || ')');
  perform cd.ok((select count(*) from public.applied_discounts where discount_id = cd.get('promo') and amount = 30) = 1, 'promo: use recorded');
  v := cd.run_svc(format($q$select public.register_camp(%L::jsonb)::text$q$, cd.payload(cd.child(jsonb_build_object('first_name', 'Promo2', 'discounts', jsonb_build_array(jsonb_build_object('discount_id', cd.get('promo'), 'amount', 30, 'code', 'SPRING27')))),
    '{"parent": {"name": "P3", "email": "p3@example.test", "phone": "000", "emergency_name": "E", "emergency_phone": "000"}}')));
  perform cd.ok(v like '%PROMO_LIMIT_REACHED%', 'promo: usage limit enforced (' || left(v, 60) || ')');
end $$;

-- Capacity (4): 3 taken, 2 more refused; window closed refused
do $$
declare v text;
begin
  perform cd.ok((select count(*) from public.registrations where camp_edition_id = cd.get('ed')) = 3, 'capacity: 3 of 4 taken');
  v := cd.run_svc(format($q$select public.register_camp(%L::jsonb)::text$q$, cd.payload(cd.child('{}') || cd.child('{"first_name": "Other"}'),
    '{"parent": {"name": "P4", "email": "p4@example.test", "phone": "000", "emergency_name": "E", "emergency_phone": "000"}}')));
  perform cd.ok(v like '%EDITION_FULL%', 'capacity: over-booking refused (' || left(v, 60) || ')');
  update public.camp_editions set registration_closes_at = now() - interval '1 minute', registration_opens_at = now() - interval '2 days' where id = cd.get('ed');
  v := cd.run_svc(format($q$select public.register_camp(%L::jsonb)::text$q$, cd.payload(cd.child('{}'),
    '{"parent": {"name": "P5", "email": "p5@example.test", "phone": "000", "emergency_name": "E", "emergency_phone": "000"}}')));
  perform cd.ok(v like '%REGISTRATION_CLOSED%', 'window: closed edition refused');
  update public.camp_editions set registration_closes_at = now() + interval '30 days' where id = cd.get('ed');
end $$;

-- Parent mode: own family only, no double registration
do $$
declare v text; r jsonb;
begin
  v := cd.run_svc(format($q$select public.register_camp(%L::jsonb)::text$q$, jsonb_build_object('mode', 'parent', 'program_id', cd.get('camp'), 'edition_id', cd.get('ed'),
    'family_id', '00000000-0000-0000-0000-000000000061', 'registered_by', '00000000-0000-0000-0000-0000000000f4',
    'children', jsonb_build_array(jsonb_build_object('athlete_id', '00000000-0000-0000-0000-000000000072', 'age_group_id', cd.get('g1217'),
      'price_option_id', cd.get('opt2n'), 'days', cd.days(2), 'list_amount', 200)))));
  perform cd.ok(v like '%ATHLETE_NOT_FOUND%', 'parent mode: a child of another family is refused');
  v := cd.run_svc(format($q$select public.register_camp(%L::jsonb)::text$q$, jsonb_build_object('mode', 'parent', 'program_id', cd.get('camp'), 'edition_id', cd.get('ed'),
    'family_id', '00000000-0000-0000-0000-000000000061', 'registered_by', '00000000-0000-0000-0000-0000000000f4',
    'children', jsonb_build_array(jsonb_build_object('athlete_id', '00000000-0000-0000-0000-000000000071', 'age_group_id', cd.get('g812'),
      'price_option_id', cd.get('opt2n'), 'days', cd.days(2), 'list_amount', 200)))));
  perform cd.ok(v like 'OK:%', 'parent mode: own child registered (' || left(v, 80) || ')');
  r := substr(v, 4)::jsonb;
  insert into cd.ctx values ('regp', r->'registration_ids'->>0), ('invp', r->>'invoice_id');
  perform cd.ok((select membership_status from public.families where id = '00000000-0000-0000-0000-000000000061') = 'member', 'parent mode: existing family stays a member');
  update public.camp_editions set capacity = 10 where id = cd.get('ed');
  v := cd.run_svc(format($q$select public.register_camp(%L::jsonb)::text$q$, jsonb_build_object('mode', 'parent', 'program_id', cd.get('camp'), 'edition_id', cd.get('ed'),
    'family_id', '00000000-0000-0000-0000-000000000061',
    'children', jsonb_build_array(jsonb_build_object('athlete_id', '00000000-0000-0000-0000-000000000071', 'age_group_id', cd.get('g812'),
      'price_option_id', cd.get('opt2n'), 'days', cd.days(2), 'list_amount', 200)))));
  perform cd.ok(v like '%ALREADY_REGISTERED%', 'parent mode: no double registration for the same edition');
end $$;

-- ===========================================================================
-- 6. Price snapshot integrity
-- ===========================================================================
do $$
declare v text; parent uuid := '00000000-0000-0000-0000-0000000000f4'; fin uuid := '00000000-0000-0000-0000-0000000000f2';
begin
  v := cd.run_as(parent, format($q$with u as (update public.registrations set price_amount = 1 where id = %L returning 1) select count(*) from u$q$, cd.get('regp')));
  perform cd.ok(v like '%PRICE_SNAPSHOT_LOCKED%', 'guardian cannot rewrite the price snapshot (' || left(v, 60) || ')');
  v := cd.run_as(fin, format($q$with u as (update public.registrations set price_snapshot = '{}' where id = %L returning 1) select count(*) from u$q$, cd.get('regp')));
  perform cd.ok(v like '%PRICE_SNAPSHOT_LOCKED%', 'finance cannot rewrite the price snapshot directly');
  v := cd.run_as(fin, format($q$with u as (update public.registrations set camp_days = '{}' where id = %L returning 1) select count(*) from u$q$, cd.get('regp')));
  perform cd.ok(v like '%PRICE_SNAPSHOT_LOCKED%', 'finance cannot change the chosen days directly');
  v := cd.run_as(fin, format($q$with u as (update public.registrations set status = 'confirmed' where id = %L returning 1) select count(*) from u$q$, cd.get('regp')));
  perform cd.ok(v = 'OK:1', 'finance can still confirm the registration');
  update public.camp_price_options set price = 999 where id = cd.get('opt2n');
  perform cd.ok((select price_amount from public.registrations where id = cd.get('regp')) = 200
            and (select total_chf from public.invoices where id = cd.get('invp')) = 200, 'a later price change does not touch the registration or invoice');
  update public.camp_price_options set price = 200 where id = cd.get('opt2n');
  v := cd.run_as(parent, format($q$insert into public.registrations (org_id, athlete_id, program_id, camp_edition_id) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071', %L, %L) returning id::text$q$, cd.get('camp'), (select id from public.camp_editions where program_id = cd.get('camp') and id <> cd.get('ed') limit 1)));
  perform cd.ok(v like 'ERR:%', 'guardian cannot insert a camp registration directly (' || left(v, 60) || ')');
  v := cd.run_as(parent, format($q$insert into public.registrations (org_id, athlete_id, program_id) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071', %L) returning id::text$q$, cd.get('camp')));
  perform cd.ok(v like '%USE_CAMP_REGISTRATION%' or v like 'ERR:%', 'guardian cannot bypass editions with a plain registration (' || left(v, 60) || ')');
  v := cd.run_as(parent, format($q$with u as (update public.registrations set status = 'cancelled' where id = %L returning 1) select count(*) from u$q$, cd.get('regp')));
  perform cd.ok(v = 'OK:1', 'guardian can still cancel their own registration');
  v := cd.run_as(parent, format($q$select count(*) from public.applied_discounts where registration_id = %L$q$, cd.get('reg2')));
  perform cd.ok(v = 'OK:0', 'guardian of another family does not see its applied discounts');
end $$;

-- ===========================================================================
-- 7. apply_manual_discount
-- ===========================================================================
do $$
declare v text; fin uuid := '00000000-0000-0000-0000-0000000000f2'; parent uuid := '00000000-0000-0000-0000-0000000000f4';
  b uuid := 'b0000000-0000-0000-0000-0000000000b1'; v_before numeric;
begin
  v := cd.run_as(parent, format($q$select public.apply_manual_discount(%L, %L, 'x')::text$q$, cd.get('reg1'), cd.get('manual')));
  perform cd.ok(v like 'ERR:%NOT_AUTHORIZED%', 'manual discount: refused for a parent');
  v := cd.run_as(b, format($q$select public.apply_manual_discount(%L, %L, 'x')::text$q$, cd.get('reg1'), cd.get('manual')));
  perform cd.ok(v like 'ERR:%', 'manual discount: refused for another club''s finance (' || left(v, 60) || ')');
  select total_chf + adjustments_total into v_before from public.invoices where id = cd.get('inv1');
  v := cd.run_as(fin, format($q$select public.apply_manual_discount(%L, %L, 'Goodwill gesture')::text$q$, cd.get('reg1'), cd.get('manual')));
  perform cd.ok(v like 'OK:%', 'manual discount: applied by finance (' || left(v, 120) || ')');
  perform cd.ok((select price_amount = 440 and price_discount_amount = 110 from public.registrations where id = cd.get('reg1')), 'manual discount: 20% of 550 = 110 off the snapshot');
  perform cd.ok((select count(*) from public.invoice_adjustments where invoice_id = cd.get('inv1') and kind = 'credit_note' and amount = 110) = 1,
                'manual discount on an issued invoice = credit note of 110');
  perform cd.ok((select total_chf + adjustments_total from public.invoices where id = cd.get('inv1')) = v_before - 110, 'amount due reduced by 110');
  perform cd.ok((select count(*) from public.applied_discounts where registration_id = cd.get('reg1') and invoice_adjustment_id is not null and reason = 'Goodwill gesture') = 1,
                'manual discount recorded with its credit note and reason');
  v := cd.run_as(fin, format($q$select public.apply_manual_discount(%L, %L, 'again')::text$q$, cd.get('reg1'), cd.get('manual')));
  perform cd.ok(v like '%DISCOUNT_ALREADY_APPLIED%', 'manual discount: not twice');
  v := cd.run_as(fin, format($q$with u as (update public.applied_discounts set amount = 1 where registration_id = %L returning 1) select count(*) from u$q$, cd.get('reg1')));
  perform cd.ok(v = 'OK:0' or v like 'ERR:%', 'applied discount amounts cannot be edited directly');
end $$;

-- ===========================================================================
-- 8. Edition with registrations is archived, never deleted
-- ===========================================================================
do $$
declare v text;
begin
  v := cd.run_as('00000000-0000-0000-0000-0000000000f1', format($q$with u as (delete from public.camp_editions where id = %L returning 1) select count(*) from u$q$, cd.get('ed')));
  perform cd.ok(v like '%EDITION_HAS_REGISTRATIONS%', 'edition delete blocked while it has registrations (' || left(v, 60) || ')');
  v := cd.run_as('00000000-0000-0000-0000-0000000000f1', format($q$with u as (update public.camp_editions set status = 'archived' where id = %L returning archived_at) select (count(*) = 1 and bool_and(archived_at is not null))::text from u$q$, cd.get('ed')));
  perform cd.ok(v = 'OK:true', 'edition archived with a timestamp');
end $$;
