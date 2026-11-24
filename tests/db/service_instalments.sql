-- ============================================================================
-- Service instalments suite (migration 20250420105400_service_instalments.sql)
--
--   A. Split (authoritative SQL): 1..4 payments, 450/4, 550/3, 100/3, sums
--      exact; 0 and 5 payments refused. Default due dates (+1 month, month
--      end clamped). Staff due-date rules.
--   B. Eligibility: max_instalments per service (1 = refused), 5 payments,
--      fractional counts, coach refused, services editor (roles, bounds,
--      cross-tenant).
--   C. Package order 450 in 4 payments: choice stored once (replay), one
--      invoice per payer with ONE plan (retry of the invoice run and of the
--      attach = same plan), total counted once, default dates.
--   D. Payments: allocated to the invoice once, instalments paid oldest
--      first, balance down, plan completed when paid in full.
--   E. Group order, two payers, 3 payments with staff dates: each payer
--      invoice gets its own plan on its own total (550 -> 183.33 x2 + 183.34).
--   F. Draft invoice: no plan while draft, plan when issued.
--   G. Family request (parent app): choice stored on the booking, dates
--      forbidden to parents, plan on the invoice with default dates.
--   H. Unchanged behaviour: pay in full (1) and existing bookings get no
--      plan; other invoices are never touched by the trigger.
--   I. Cross-tenant denial: reads, editor, confirm, plans.
--   J. Regression: membership (club_installment_schedule) and EYBL
--      (selection_due_dates + plan_split) generation unchanged; a regular
--      plan_choose still produces the club-rule plan.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3 =
-- coach …011, guardian …f4 of family …061 / athlete …071; family …062 =
-- athletes …072, …073). Org B …0002. SYNTHETIC DATA ONLY.
-- Deferred work (the plan is attached at COMMIT) is checked in the NEXT
-- statement. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema si;
grant usage on schema si to authenticated, anon, service_role;
create table si.ctx (k text primary key, v text);
grant all on si.ctx to authenticated, anon, service_role;

create function si.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function si.put(p_k text, p_v text) returns void language sql as $$
  insert into si.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function si.get(p_k text) returns text language sql stable as $$ select v from si.ctx where k = p_k $$;
create function si.uid(p_k text) returns uuid language sql stable as $$ select v::uuid from si.ctx where k = p_k $$;
create function si.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
create function si.j(p uuid, p_sql text) returns jsonb language plpgsql as $$
declare r text := si.run_as(p, p_sql);
begin
  if left(r, 3) = 'OK:' then
    if substr(r, 4) = '<null>' then return 'null'::jsonb; end if;
    return substr(r, 4)::jsonb;
  end if;
  return jsonb_build_object('err', substr(r, 5));
end $$;
create function si.err(p jsonb) returns text language sql immutable as $$ select split_part(p->>'err', ':', 1) $$;
create function si.at(p_day text, p_hours numeric) returns text language sql stable as $$
  select (si.get(p_day)::timestamptz + make_interval(mins => (p_hours * 60)::int))::text
$$;
create function si.confirm(p_user text, p jsonb, p_req uuid default gen_random_uuid()) returns jsonb language sql as $$
  select si.j(si.uid(p_user), format('select public.booking_order_confirm_plan(%L, %L)::text', p, p_req))
$$;
create function si.invoice(p_user text, p_orders uuid[], p_req uuid default gen_random_uuid(), p_send boolean default true) returns jsonb language sql as $$
  select si.j(si.uid(p_user), format('select public.booking_order_create_invoices(%L::uuid[], %L, %L)::text', p_orders, p_req, p_send))
$$;
create function si.pay(p_user text, p_order uuid, p_inv uuid, p_amount numeric, p_req uuid default gen_random_uuid()) returns jsonb language sql as $$
  select si.j(si.uid(p_user), format('select public.booking_order_record_payment(%L, %L, %L)::text', p_order, p_inv,
              jsonb_build_object('request_id', p_req, 'amount', p_amount, 'method', 'bank_transfer')))
$$;
-- Live plan of an invoice: amounts and dates as text arrays.
create function si.plan_of(p_inv uuid) returns uuid language sql stable as $$
  select id from public.payment_plans where invoice_id = p_inv and kind = 'installments' and status in ('active','paused','completed')
$$;
create function si.amounts(p_inv uuid) returns text language sql stable as $$
  select string_agg(trim(to_char(i.amount, 'FM999990.00')), ',' order by i.seq)
    from public.payment_plan_installments i where i.plan_id = si.plan_of(p_inv)
$$;
create function si.dates(p_inv uuid) returns date[] language sql stable as $$
  select array_agg(i.due_date order by i.seq) from public.payment_plan_installments i where i.plan_id = si.plan_of(p_inv)
$$;
grant execute on all functions in schema si to authenticated, anon, service_role;

select si.put('org', '00000000-0000-0000-0000-000000000001'),
       si.put('orgB', '10000000-0000-0000-0000-000000000002'),
       si.put('admin', '00000000-0000-0000-0000-0000000000f1'),
       si.put('finance', '00000000-0000-0000-0000-0000000000f2'),
       si.put('coach', '00000000-0000-0000-0000-0000000000f3'),
       si.put('guardian', '00000000-0000-0000-0000-0000000000f4'),
       si.put('guardian2', '00000000-0000-0000-0000-0000000009b2'),
       si.put('adminB', 'b0000000-0000-0000-0000-0000000009b5'),
       si.put('coachRow', '00000000-0000-0000-0000-000000000011'),
       si.put('a71', '00000000-0000-0000-0000-000000000071'),
       si.put('a72', '00000000-0000-0000-0000-000000000072'),
       si.put('venue', '00000000-0000-0000-0000-0000000009a1'),
       si.put('svcPt', '00000000-0000-0000-0000-0000000009c1'),
       si.put('svcGrp', '00000000-0000-0000-0000-0000000009c2'),
       si.put('svcFull', '00000000-0000-0000-0000-0000000009c3'),
       si.put('pk5', '00000000-0000-0000-0000-0000000009d5'),
       si.put('d1', ((current_date + 10)::timestamp at time zone 'UTC')::text),
       si.put('d2', ((current_date + 11)::timestamp at time zone 'UTC')::text),
       si.put('d3', ((current_date + 12)::timestamp at time zone 'UTC')::text),
       si.put('d4', ((current_date + 13)::timestamp at time zone 'UTC')::text);

insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000009b5', 'si-admin-b@example.test'),
  ('00000000-0000-0000-0000-0000000009b2', 'si-guardian2@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000009b5';
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic SI Guardian' where id = '00000000-0000-0000-0000-0000000009b2';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000009b5', 'admin'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000009b2', 'parent');
insert into public.family_members (family_id, profile_id, relation) values
  ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-0000000009b2', 'guardian');
update public.organizations set timezone = 'Europe/Zurich' where id = '00000000-0000-0000-0000-000000000001';
insert into public.app_settings (org_id) values ('00000000-0000-0000-0000-000000000001') on conflict (org_id) do nothing;
update public.app_settings set settings = coalesce(settings, '{}'::jsonb) || '{"bookings_enabled": true}'::jsonb
 where org_id = '00000000-0000-0000-0000-000000000001';
insert into public.venues (id, org_id, name, opening_hours) values
  ('00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-000000000001', 'SI Hall',
   jsonb_build_object('1', '[["07:00","21:00"]]'::jsonb, '2', '[["07:00","21:00"]]'::jsonb, '3', '[["07:00","21:00"]]'::jsonb,
                      '4', '[["07:00","21:00"]]'::jsonb, '5', '[["07:00","21:00"]]'::jsonb, '6', '[["07:00","21:00"]]'::jsonb,
                      '7', '[["07:00","21:00"]]'::jsonb));
insert into public.training_services (id, org_id, slug, name, duration_min, price_chf, kind, session_type, max_participants, currency, venue_id, billing_category) values
  ('00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-000000000001', 'si-pt', 'SI Personal Training', 60, 95, 'private', 'individual', 1, 'CHF', '00000000-0000-0000-0000-0000000009a1', 'training'),
  ('00000000-0000-0000-0000-0000000009c2', '00000000-0000-0000-0000-000000000001', 'si-grp', 'SI Group Training', 60, 0, 'group', 'group', 6, 'CHF', '00000000-0000-0000-0000-0000000009a1', 'training'),
  ('00000000-0000-0000-0000-0000000009c3', '00000000-0000-0000-0000-000000000001', 'si-full', 'SI Pay In Full', 60, 120, 'private', 'individual', 1, 'CHF', '00000000-0000-0000-0000-0000000009a1', 'training');
update public.training_services set group_rate_chf = 275 where id = '00000000-0000-0000-0000-0000000009c2';
insert into public.credit_packages (id, org_id, service_id, name, credits, price_chf, sort_order, is_active) values
  ('00000000-0000-0000-0000-0000000009d5', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000009c1', '5 sessions', 5, 450, 10, true);
insert into public.training_service_coaches (org_id, service_id, coach_id)
select '00000000-0000-0000-0000-000000000001', s, '00000000-0000-0000-0000-000000000011'
  from unnest(array['00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009c2',
                    '00000000-0000-0000-0000-0000000009c3']::uuid[]) s;
insert into public.coach_availability (org_id, coach_id, starts_at, ends_at, capacity)
select '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011',
       si.at(d, 7)::timestamptz, si.at(d, 18)::timestamptz, 10
  from unnest(array['d1', 'd2', 'd3', 'd4']) d;
do $$
begin
  perform si.run_as(si.uid('admin'), 'select public.invoice_number_series_set(''training'', ''SI PT'', true)::text');
end $$;

-- ===========================================================================
-- A. Split + dates (pure)
-- ===========================================================================
do $$
declare v text;
begin
  perform si.ok(public.service_instalment_split(450, 1, 'CHF') = array[450]::numeric[], 'split: 450 in 1 payment = 450.00');
  perform si.ok(public.service_instalment_split(450, 2, 'CHF') = array[225, 225]::numeric[], 'split: 450 in 2 = 225.00 x2');
  perform si.ok(public.service_instalment_split(450, 3, 'CHF') = array[150, 150, 150]::numeric[], 'split: 450 in 3 = 150.00 x3');
  perform si.ok(public.service_instalment_split(450, 4, 'CHF') = array[112.50, 112.50, 112.50, 112.50]::numeric[], 'split: 450 in 4 = 112.50 x4');
  perform si.ok(public.service_instalment_split(550, 3, 'CHF') = array[183.33, 183.33, 183.34]::numeric[], 'split: 550 in 3 = 183.33, 183.33, 183.34');
  perform si.ok(public.service_instalment_split(100, 3, 'CHF') = array[33.33, 33.33, 33.34]::numeric[], 'split: 100 in 3 = 33.33, 33.33, 33.34');
  perform si.ok(public.service_instalment_split(0.05, 4, 'CHF') = array[0.01, 0.01, 0.01, 0.02]::numeric[], 'split: 0.05 in 4 = 0.01 x3 + 0.02 (last absorbs)');
  perform si.ok((select bool_and((select sum(x) from unnest(public.service_instalment_split(t, n, 'CHF')) x) = t)
                   from unnest(array[0.01, 1, 99.99, 100, 450, 550, 1280, 1234.57]::numeric[]) t, generate_series(1, 4) n),
                'split: every total x 1..4 sums exactly to the total');
  begin perform public.service_instalment_split(100, 5, 'CHF'); v := 'none'; exception when others then v := sqlerrm; end;
  perform si.ok(v = 'INSTALMENTS_OUT_OF_RANGE', 'split: 5 payments refused (' || v || ')');
  begin perform public.service_instalment_split(100, 0, 'CHF'); v := 'none'; exception when others then v := sqlerrm; end;
  perform si.ok(v = 'INSTALMENTS_OUT_OF_RANGE', 'split: 0 payments refused');

  perform si.ok(public.service_instalment_dates('2027-01-31', 4) = array['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']::date[],
                'dates: first, then +1 month each, clamped to the month end');
  perform si.ok(public.service_instalment_dates('2026-12-15', 3) = array['2026-12-15', '2027-01-15', '2027-02-15']::date[],
                'dates: across the year end');
  perform si.ok(public.service_instalment_dates_error(array['2027-01-10', '2027-02-10']::date[], 2, '2027-01-01') is null,
                'staff dates: ascending, from today, within 12 months -> valid');
  perform si.ok(public.service_instalment_dates_error(array['2027-02-10', '2027-01-10']::date[], 2, '2027-01-01') = 'INSTALMENT_DATES_INVALID',
                'staff dates: descending refused');
  perform si.ok(public.service_instalment_dates_error(array['2027-01-10', '2027-01-10']::date[], 2, '2027-01-01') = 'INSTALMENT_DATES_INVALID',
                'staff dates: two payments on the same day refused');
  perform si.ok(public.service_instalment_dates_error(array['2026-12-31', '2027-01-10']::date[], 2, '2027-01-01') = 'INSTALMENT_DATES_INVALID',
                'staff dates: before today refused');
  perform si.ok(public.service_instalment_dates_error(array['2027-01-10', '2028-01-02']::date[], 2, '2027-01-01') = 'INSTALMENT_DATES_INVALID',
                'staff dates: more than 12 months ahead refused');
  perform si.ok(public.service_instalment_dates_error(array['2027-01-10']::date[], 2, '2027-01-01') = 'INSTALMENT_DATES_INVALID',
                'staff dates: one date per payment');
end $$;

-- ===========================================================================
-- B. Eligibility (data-driven) + services editor
-- ===========================================================================
do $$
declare r jsonb; p jsonb;
begin
  perform si.ok((select max_instalments from public.training_services where id = si.uid('svcPt')) = 1,
                'default: a service allows 1 payment (pay in full) until the club changes it');
  r := si.j(si.uid('finance'), format('select public.service_instalments_save(%L, 4)::text', si.get('svcPt')));
  perform si.ok((r->>'ok')::boolean and (select max_instalments from public.training_services where id = si.uid('svcPt')) = 4,
                'editor: finance allows up to 4 payments');
  r := si.j(si.uid('admin'), format('select public.service_instalments_save(%L, 4)::text', si.get('svcGrp')));
  perform si.ok((r->>'ok')::boolean, 'editor: admin allows up to 4 payments on the group service');
  perform si.ok(si.err(si.j(si.uid('admin'), format('select public.service_instalments_save(%L, 5)::text', si.get('svcPt')))) = 'INSTALMENTS_OUT_OF_RANGE',
                'editor: 5 refused (absolute maximum 4)');
  perform si.ok(si.err(si.j(si.uid('coach'), format('select public.service_instalments_save(%L, 2)::text', si.get('svcPt')))) = 'NOT_AUTHORIZED',
                'editor: a coach is refused');
  perform si.ok(si.err(si.j(si.uid('guardian'), format('select public.service_instalments_save(%L, 2)::text', si.get('svcPt')))) = 'NOT_AUTHORIZED',
                'editor: a guardian is refused');
  perform si.ok(si.err(si.j(si.uid('adminB'), format('select public.service_instalments_save(%L, 1)::text', si.get('svcPt')))) = 'SERVICE_NOT_FOUND'
                and (select max_instalments from public.training_services where id = si.uid('svcPt')) = 4,
                'editor: another club''s admin gets SERVICE_NOT_FOUND (cross-tenant)');
  begin
    update public.training_services set max_instalments = 5 where id = si.uid('svcFull');
    perform si.ok(false, 'column check: 5 stored');
  exception when check_violation then
    perform si.ok(true, 'column check: max_instalments > 4 is refused by the table');
  end;

  p := jsonb_build_object('service_id', si.get('svcFull'), 'option', 'single', 'coach_id', si.get('coachRow'),
                          'dates', jsonb_build_array(si.at('d1', 8)), 'participants', jsonb_build_array(jsonb_build_object('athlete_id', si.get('a71'))));
  r := si.confirm('admin', p || '{"instalments": 2}'::jsonb);
  perform si.ok(si.err(r) = 'INSTALMENTS_NOT_ALLOWED' and not exists (select 1 from public.booking_orders where service_id = si.uid('svcFull')),
                'confirm: 2 payments on a pay-in-full service refused, nothing written');
  p := p || jsonb_build_object('service_id', si.get('svcPt'));
  r := si.confirm('admin', p || '{"instalments": 5}'::jsonb);
  perform si.ok(si.err(r) = 'INSTALMENTS_OUT_OF_RANGE', 'confirm: 5 payments refused');
  r := si.confirm('admin', p || '{"instalments": 2.5}'::jsonb);
  perform si.ok(si.err(r) = 'INSTALMENTS_OUT_OF_RANGE', 'confirm: a fractional count refused');
  r := si.confirm('admin', p || '{"instalments": "3"}'::jsonb);
  perform si.ok(si.err(r) = 'INSTALMENTS_OUT_OF_RANGE', 'confirm: a non-number count refused');
  r := si.confirm('coach', p || '{"instalments": 2}'::jsonb);
  perform si.ok(si.err(r) = 'NOT_AUTHORIZED', 'confirm: a coach is refused');
  r := si.confirm('admin', p || jsonb_build_object('instalments', 2, 'instalment_dates', jsonb_build_array((current_date + 20)::text, (current_date + 10)::text)));
  perform si.ok(si.err(r) = 'INSTALMENT_DATES_INVALID', 'confirm: staff dates not ascending refused');
  r := si.confirm('admin', p || jsonb_build_object('instalments', 2, 'instalment_dates', jsonb_build_array((current_date - 1)::text, (current_date + 10)::text)));
  perform si.ok(si.err(r) = 'INSTALMENT_DATES_INVALID', 'confirm: staff date in the past refused');
  r := si.confirm('admin', p || jsonb_build_object('instalments', 2, 'instalment_dates', jsonb_build_array((current_date + 5)::text, (current_date + 400)::text)));
  perform si.ok(si.err(r) = 'INSTALMENT_DATES_INVALID', 'confirm: staff date beyond 12 months refused');
  r := si.confirm('admin', p || jsonb_build_object('instalments', 3, 'instalment_dates', jsonb_build_array((current_date + 5)::text, (current_date + 30)::text)));
  perform si.ok(si.err(r) = 'INSTALMENT_DATES_INVALID', 'confirm: a date per payment is required');
  perform si.ok(not exists (select 1 from public.booking_orders where service_id = si.uid('svcPt')), 'confirm: refusals wrote nothing');
end $$;

-- ===========================================================================
-- C. Package 450 in 4 payments: idempotent choice, one invoice, one plan
-- ===========================================================================
do $$
declare r jsonb; r2 jsonb; v_req uuid := gen_random_uuid(); p jsonb; o uuid; inv jsonb; v_ireq uuid := gen_random_uuid();
begin
  p := jsonb_build_object('service_id', si.get('svcPt'), 'option', 'package', 'package_id', si.get('pk5'), 'coach_id', si.get('coachRow'),
                          'dates', jsonb_build_array(si.at('d1', 9)), 'participants', jsonb_build_array(jsonb_build_object('athlete_id', si.get('a72'))),
                          'instalments', 4);
  r := si.confirm('finance', p, v_req);
  r2 := si.confirm('finance', p, v_req);
  o := (r->>'order_id')::uuid;
  perform si.put('oPkg', o::text);
  perform si.put('oPkgReq', v_ireq::text);
  perform si.ok((r->>'ok')::boolean and (r->>'instalments')::int = 4 and (r2->>'replayed')::boolean and r2->>'order_id' = o::text
                and (select count(*) from public.booking_orders where request_id = v_req) = 1
                and (select instalment_count from public.booking_orders where id = o) = 4,
                'package: order created with 4 payments; retry with the same request id replays (one order)');
  r := si.confirm('finance', p || '{"instalments": 2}'::jsonb, v_req);
  perform si.ok((r->>'replayed')::boolean and (select instalment_count from public.booking_orders where id = o) = 4,
                'package: a retry cannot change the stored choice');
  perform si.ok((select count(*) from public.audit_logs where action = 'BOOKING_ORDER_INSTALMENTS_CHOSEN' and target_id = o) = 1,
                'package: the choice is audited once');
  inv := si.invoice('finance', array[o], v_ireq);
  perform si.put('invPkg', inv->'invoices'->0->>'invoice_id');
  perform si.ok((inv->>'ok')::boolean and jsonb_array_length(inv->'invoices') = 1 and (inv->'invoices'->0->>'total')::numeric = 450,
                'package: one invoice for the payer, total 450');
end $$;

do $$
declare inv jsonb; v_plan uuid; v_due date;
begin
  v_plan := si.plan_of(si.uid('invPkg'));
  perform si.ok(v_plan is not null and (select count(*) from public.payment_plans where invoice_id = si.uid('invPkg')) = 1,
                'package: one instalment plan attached to the payer invoice at commit');
  perform si.ok(si.amounts(si.uid('invPkg')) = '112.50,112.50,112.50,112.50', 'package: 450 in 4 = 112.50 x4 (' || coalesce(si.amounts(si.uid('invPkg')), 'none') || ')');
  select original_due_date into v_due from public.payment_plans where id = v_plan;
  perform si.ok(si.dates(si.uid('invPkg')) = public.service_instalment_dates(greatest(v_due, public.ta_today(si.uid('org'))), 4)
                and v_due = public.ta_today(si.uid('org')) + (public.bk_settings(si.uid('org'))->>'invoice_due_days')::int,
                'package: default dates = invoice due date (issue + booking term), then +1 month each');
  perform si.ok((select source = 'service' and amount_total = 450 and installment_count = 4 and fee_amount = 0 and kind = 'installments'
                   from public.payment_plans where id = v_plan),
                'package: plan source service, total 450, no fee');
  perform si.ok((select total_chf from public.invoices where id = si.uid('invPkg')) = 450
                and public.invoice_amount_due(si.uid('invPkg')) = 450
                and (select count(*) from public.invoices i where exists (select 1 from public.payment_plan_installments x where x.plan_id = v_plan and x.invoice_id = i.id)) = 1,
                'package: total counted once (one invoice of 450; instalments point at it, no extra invoices)');
  perform si.ok((select due_date from public.invoices where id = si.uid('invPkg')) = (si.dates(si.uid('invPkg')))[4],
                'package: the invoice is due with its last instalment (existing plan rule)');
  inv := si.invoice('finance', array[si.uid('oPkg')], si.uid('oPkgReq'));
  perform si.ok((inv->>'replayed')::boolean and inv->'invoices'->0->>'invoice_id' = si.get('invPkg'),
                'package: invoice run retried with the same request id replays');
  perform si.ok(public.svc_plan_attach(si.uid('invPkg')) = v_plan, 'package: attaching again returns the same plan');
end $$;

do $$
begin
  perform si.ok((select count(*) from public.payment_plans where invoice_id = si.uid('invPkg')) = 1
                and (select count(*) from public.invoices where id in (select invoice_id from public.training_package_purchases
                                                                         where id = (select purchase_id from public.booking_orders where id = si.uid('oPkg')))) = 1,
                'package: after retries still one plan and one invoice');
end $$;

-- ===========================================================================
-- D. Payments: allocated once, oldest instalment first
-- ===========================================================================
do $$
declare r jsonb; r2 jsonb; v_req uuid := gen_random_uuid();
begin
  r := si.pay('finance', si.uid('oPkg'), si.uid('invPkg'), 200, v_req);
  r2 := si.pay('finance', si.uid('oPkg'), si.uid('invPkg'), 200, v_req);
  perform si.ok(r->>'err' is null and (r2->>'replayed')::boolean and public.invoice_net_paid(si.uid('invPkg')) = 200,
                'payments: 200 recorded once (retry replays)');
end $$;

do $$
declare v_plan uuid := si.plan_of(si.uid('invPkg')); s text;
begin
  select string_agg(status || ':' || trim(to_char(amount_paid, 'FM999990.00')), ',' order by seq) into s
    from public.payment_plan_installments where plan_id = v_plan;
  perform si.ok(s = 'paid:112.50,scheduled:87.50,scheduled:0.00,scheduled:0.00',
                'payments: instalment 1 paid, 87.50 on instalment 2 (oldest first) (' || s || ')');
  perform si.ok(public.invoice_amount_due(si.uid('invPkg')) - public.invoice_net_paid(si.uid('invPkg')) = 250
                and (select status::text from public.invoices where id = si.uid('invPkg')) not in ('paid'),
                'payments: invoice balance 250 (450 - 200, counted once)');
  perform si.ok(si.run_as(si.uid('guardian2'), format('select count(*)::text from public.payment_plan_installments where plan_id = %L', v_plan)) = 'OK:4'
                and si.run_as(si.uid('guardian'), format('select count(*)::text from public.payment_plan_installments where plan_id = %L', v_plan)) = 'OK:0',
                'parent app: the paying family''s guardian reads the 4 instalments; another family reads none');
end $$;

do $$
declare r jsonb;
begin
  r := si.pay('finance', si.uid('oPkg'), si.uid('invPkg'), 250);
end $$;

do $$
declare v_plan uuid := si.plan_of(si.uid('invPkg'));
begin
  perform si.ok((select bool_and(status = 'paid') from public.payment_plan_installments where plan_id = v_plan)
                and (select status from public.payment_plans where id = v_plan) = 'completed'
                and (select status::text from public.invoices where id = si.uid('invPkg')) = 'paid'
                and public.invoice_net_paid(si.uid('invPkg')) = 450,
                'payments: paid in full -> all instalments paid, plan completed, invoice paid, 450 received once');
end $$;

-- ===========================================================================
-- E. Group order: two payers, 3 payments, staff dates -> one plan per payer
-- ===========================================================================
do $$
declare r jsonb; p jsonb; o uuid; inv jsonb; v_d text[];
begin
  v_d := array[(current_date + 5)::text, (current_date + 35)::text, (current_date + 65)::text];
  perform si.put('grpDates', array_to_string(v_d, ','));
  p := jsonb_build_object('service_id', si.get('svcGrp'), 'option', 'group', 'coach_id', si.get('coachRow'),
                          'dates', jsonb_build_array(si.at('d2', 10), si.at('d3', 10)),
                          'participants', jsonb_build_array(
                            jsonb_build_object('athlete_id', si.get('a71')),
                            jsonb_build_object('athlete_id', si.get('a72'), 'dates', jsonb_build_array(si.at('d2', 10)))),
                          'instalments', 3, 'instalment_dates', to_jsonb(v_d));
  r := si.confirm('finance', p);
  o := (r->>'order_id')::uuid;
  perform si.put('oGrp', o::text);
  perform si.ok((r->>'ok')::boolean and (select instalment_count = 3 and instalment_dates = v_d::date[] and instalment_dates_by = si.uid('finance')
                                           from public.booking_orders where id = o),
                'group: 3 payments with the staff due dates stored on the order (' || coalesce(r->>'err', r->>'code', 'ok') || ')');
  inv := si.invoice('admin', array[o]);
  perform si.ok(jsonb_array_length(inv->'invoices') = 2, 'group: one invoice per payer (2)');
  perform si.put('invG1', (select e->>'invoice_id' from jsonb_array_elements(inv->'invoices') e where (e->>'total')::numeric = 550));
  perform si.put('invG2', (select e->>'invoice_id' from jsonb_array_elements(inv->'invoices') e where (e->>'total')::numeric = 275));
end $$;

do $$
begin
  perform si.ok(si.plan_of(si.uid('invG1')) is not null and si.plan_of(si.uid('invG2')) is not null
                and si.plan_of(si.uid('invG1')) <> si.plan_of(si.uid('invG2')),
                'group: each payer invoice gets its own plan');
  perform si.ok(si.amounts(si.uid('invG1')) = '183.33,183.33,183.34', 'group: payer 1 550 in 3 = 183.33, 183.33, 183.34 (' || coalesce(si.amounts(si.uid('invG1')), 'none') || ')');
  perform si.ok(si.amounts(si.uid('invG2')) = '91.66,91.66,91.68', 'group: payer 2 275 in 3 = 91.66, 91.66, 91.68 (' || coalesce(si.amounts(si.uid('invG2')), 'none') || ')');
  perform si.ok(si.dates(si.uid('invG1')) = string_to_array(si.get('grpDates'), ',')::date[]
                and si.dates(si.uid('invG2')) = string_to_array(si.get('grpDates'), ',')::date[],
                'group: both plans use the staff due dates');
  perform si.ok((select sum(amount_total) from public.payment_plans where invoice_id in (si.uid('invG1'), si.uid('invG2'))) = 825
                and (select sum(total_chf) from public.invoices where id in (si.uid('invG1'), si.uid('invG2'))) = 825,
                'group: plans total 825 = the two invoices (counted once)');
end $$;

-- ===========================================================================
-- F. Draft invoice: plan only once issued
-- ===========================================================================
do $$
declare r jsonb; o uuid; inv jsonb;
begin
  r := si.confirm('admin', jsonb_build_object('service_id', si.get('svcPt'), 'option', 'single', 'coach_id', si.get('coachRow'),
                          'dates', jsonb_build_array(si.at('d4', 8)), 'participants', jsonb_build_array(jsonb_build_object('athlete_id', si.get('a71'))),
                          'instalments', 2));
  o := (r->>'order_id')::uuid;
  inv := si.invoice('finance', array[o], gen_random_uuid(), false);
  perform si.put('invDraft', inv->'invoices'->0->>'invoice_id');
end $$;

do $$
declare r text;
begin
  perform si.ok((select status::text from public.invoices where id = si.uid('invDraft')) = 'draft' and si.plan_of(si.uid('invDraft')) is null,
                'draft: no plan while the invoice is a draft');
  r := si.run_as(si.uid('finance'), format('update public.invoices set status = %L where id = %L returning id::text', 'sent', si.get('invDraft')));
  perform si.ok(r like 'OK:%', 'draft: finance issues the invoice (' || r || ')');
end $$;

do $$
begin
  perform si.ok(si.amounts(si.uid('invDraft')) = '47.50,47.50', 'draft: plan attached at issue, 95 in 2 = 47.50 x2');
end $$;

-- ===========================================================================
-- G. Family request (parent app)
-- ===========================================================================
do $$
declare r jsonb; r2 jsonb; v_req uuid := gen_random_uuid(); p jsonb;
begin
  p := jsonb_build_object('athlete_id', si.get('a71'), 'service_id', si.get('svcPt'), 'starts_at', si.at('d3', 14));
  r := si.j(si.uid('guardian'), format('select public.booking_family_request_plan(%L, %L)::text',
            p || jsonb_build_object('instalments', 2, 'instalment_dates', jsonb_build_array((current_date + 5)::text, (current_date + 35)::text)), gen_random_uuid()));
  perform si.ok(si.err(r) = 'NOT_AUTHORIZED', 'family: parents cannot set due dates');
  r := si.j(si.uid('guardian'), format('select public.booking_family_request_plan(%L, %L)::text',
            p || jsonb_build_object('service_id', si.get('svcFull'), 'instalments', 2), gen_random_uuid()));
  perform si.ok(si.err(r) = 'INSTALMENTS_NOT_ALLOWED', 'family: an ineligible service refuses 2 payments');
  r := si.j(si.uid('guardian'), format('select public.booking_family_request_plan(%L, %L)::text', p || '{"instalments": 5}'::jsonb, gen_random_uuid()));
  perform si.ok(si.err(r) = 'INSTALMENTS_OUT_OF_RANGE', 'family: 5 payments refused');
  r := si.j(si.uid('guardian'), format('select public.booking_family_request_plan(%L, %L)::text', p || '{"instalments": 2}'::jsonb, v_req));
  r2 := si.j(si.uid('guardian'), format('select public.booking_family_request_plan(%L, %L)::text', p || '{"instalments": 2}'::jsonb, v_req));
  perform si.put('bFam', r->>'booking_id');
  perform si.ok(r->>'status' = 'requested' and (r->>'instalments')::int = 2 and (r2->>'replayed')::boolean
                and (select count(*) from public.training_bookings where request_id = v_req) = 1
                and (select instalment_count from public.training_bookings where id = si.uid('bFam')) = 2,
                'family: request stored with 2 payments; retry replays (one booking) (' || coalesce(r->>'err', 'ok') || ')');
  r := si.j(si.uid('guardian'), format('select public.booking_instalment_choice(%L)::text', si.get('bFam')));
  perform si.ok((r->>'instalments')::int = 2 and r->>'invoice_id' is null, 'family: the parent sees the choice before the invoice');
  r := si.j(si.uid('admin'), format('select public.booking_request_confirm(%L, %L)::text', si.get('bFam'), gen_random_uuid()));
  r := si.j(si.uid('finance'), format('select public.booking_create_invoice(%L, %L, true)::text', si.get('bFam'), gen_random_uuid()));
  perform si.put('invFam', r->>'invoice_id');
  perform si.ok(r->>'invoice_id' is not null, 'family: staff confirm and invoice the request (' || coalesce(r->>'err', 'ok') || ')');
end $$;

do $$
declare v_due date;
begin
  select original_due_date into v_due from public.payment_plans where id = si.plan_of(si.uid('invFam'));
  perform si.ok(si.amounts(si.uid('invFam')) = '47.50,47.50'
                and si.dates(si.uid('invFam')) = public.service_instalment_dates(greatest(v_due, public.ta_today(si.uid('org'))), 2),
                'family: plan on the booking invoice, 95 in 2, default dates');
end $$;

-- ===========================================================================
-- H. Unchanged behaviour (pay in full, existing bookings, other invoices)
-- ===========================================================================
do $$
declare r jsonb; o uuid; inv jsonb;
begin
  r := si.confirm('admin', jsonb_build_object('service_id', si.get('svcPt'), 'option', 'single', 'coach_id', si.get('coachRow'),
                          'dates', jsonb_build_array(si.at('d4', 10)), 'participants', jsonb_build_array(jsonb_build_object('athlete_id', si.get('a71')))));
  o := (r->>'order_id')::uuid;
  perform si.ok((r->>'instalments')::int = 1 and (select instalment_count from public.booking_orders where id = o) = 1,
                'pay in full: no choice = 1 payment (today''s behaviour)');
  inv := si.invoice('finance', array[o]);
  perform si.put('invFull', inv->'invoices'->0->>'invoice_id');
  -- An invoice that bills no booking (manual), issued directly.
  insert into public.invoices (id, org_id, number, family_id, description, currency, status, due_date, total_chf, activity, activity_source)
  values ('00000000-0000-0000-0000-0000000009e1', si.uid('org'), 'SI-MANUAL-1', '00000000-0000-0000-0000-000000000061',
          'Synthetic manual invoice', 'CHF', 'sent', current_date + 30, 300, 'training', 'set');
end $$;

do $$
begin
  perform si.ok(si.plan_of(si.uid('invFull')) is null, 'pay in full: the invoice has no plan');
  perform si.ok(si.plan_of('00000000-0000-0000-0000-0000000009e1') is null, 'other invoices: an issued invoice without bookings is never given a plan');
  perform si.ok((select count(*) from public.training_bookings where instalment_count <> 1 and request_source is distinct from 'family') = 0
                and (select count(*) from public.booking_orders where instalment_count > 1 and id not in (si.uid('oPkg'), si.uid('oGrp'))) = 1,
                'no backfill: only the orders that chose instalments carry them');
  perform si.ok(not exists (select 1 from public.audit_logs where action = 'SERVICE_PLAN_ATTACH_FAILED'),
                'no attach failure was recorded');
end $$;

-- ===========================================================================
-- I. Cross-tenant denial
-- ===========================================================================
do $$
declare r jsonb;
begin
  r := si.j(si.uid('adminB'), format('select public.booking_instalment_choice(%L)::text', si.get('bFam')));
  perform si.ok(r = 'null'::jsonb, 'cross-tenant: org B cannot read a booking''s choice');
  r := si.j(si.uid('adminB'), format('select public.service_instalment_info(%L::uuid[])::text', array[si.uid('svcPt')]));
  perform si.ok(r->'services' = '{}'::jsonb, 'cross-tenant: org B sees no instalment options of org A services');
  r := si.j(si.uid('admin'), format('select public.service_instalment_info(%L::uuid[])::text', array[si.uid('svcPt'), si.uid('svcFull')]));
  perform si.ok((r->'services'->>si.get('svcPt'))::int = 4 and (r->'services'->>si.get('svcFull'))::int = 1 and (r->>'max')::int = 4,
                'info: own club services with their maximum');
  r := si.confirm('adminB', jsonb_build_object('service_id', si.get('svcPt'), 'option', 'single', 'coach_id', si.get('coachRow'),
                          'dates', jsonb_build_array(si.at('d4', 12)), 'participants', jsonb_build_array(jsonb_build_object('athlete_id', si.get('a71'))),
                          'instalments', 2));
  perform si.ok(si.err(r) = 'SERVICE_NOT_FOUND', 'cross-tenant: org B cannot book org A''s service in instalments');
  perform si.ok((select substr(si.run_as(si.uid('adminB'), format('select count(*)::text from public.payment_plans where invoice_id = %L', si.get('invPkg'))), 4)) = '0'
                and (select substr(si.run_as(si.uid('adminB'), format('select count(*)::text from public.payment_plan_installments where invoice_id = %L', si.get('invPkg'))), 4)) = '0',
                'cross-tenant: org B reads no plan or instalment of org A');
  perform si.ok(si.run_as(si.uid('admin'), format('select public.svc_plan_attach(%L)::text', si.get('invFull'))) like 'ERR:%',
                'internal attach is not callable by users');
  r := si.j(si.uid('guardian'), format('select public.booking_family_request_plan(%L, %L)::text',
            jsonb_build_object('athlete_id', si.get('a72'), 'service_id', si.get('svcPt'), 'starts_at', si.at('d3', 16), 'instalments', 2), gen_random_uuid()));
  perform si.ok(si.err(r) = 'ATHLETE_NOT_FOUND', 'cross-family: a guardian cannot request instalments for another family''s child');
end $$;

-- ===========================================================================
-- J. Regression: membership + EYBL plan generation unchanged
-- ===========================================================================
do $$
declare v_got jsonb; r jsonb; v_inv uuid := '00000000-0000-0000-0000-0000000009e2';
begin
  -- EYBL (selection_plan_internal): selection_due_dates + plan_split, unchanged.
  perform si.ok(public.selection_due_dates('2026-01-31', 4) = array['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']::date[],
                'EYBL: due dates monthly from the start day (unchanged)');
  perform si.ok(public.plan_split(1000, 3, 'CHF') = array[333.33, 333.33, 333.34]::numeric[]
                and public.plan_split(1000, 12, 'CHF') = array_fill(83.33, array[11]) || array[83.37]::numeric[],
                'EYBL / club plans: plan_split unchanged (1..12+ payments)');
  -- Club plans (plan_choose): plan_due_dates unchanged.
  perform si.ok(public.plan_due_dates('2026-01-15', 3, false, 'monthly', 1, '{}') = array['2026-02-01', '2026-03-01', '2026-04-01']::date[]
                and public.plan_due_dates('2026-01-15', 2, true, 'monthly', 20, '{}') = array['2026-01-15', '2026-01-20']::date[],
                'club plans: plan_due_dates unchanged');
  -- Club Membership: the season schedule (11 instalments on the 28th, Aug-Jun).
  select jsonb_agg(jsonb_build_array(seq, due_on::text, amount::text) order by seq) into v_got
    from public.club_installment_schedule(1500, 11, '2026-08-01', 28, '2027-06-30', 'CHF');
  perform si.ok(jsonb_array_length(v_got) = 11 and v_got->0->>1 = '2026-08-28' and v_got->10->>1 = '2027-06-28'
                and (select sum(x.amount) from public.club_installment_schedule(1500, 11, '2026-08-01', 28, '2027-06-30', 'CHF') x) = 1500
                and (select string_agg(e->>2, ',' order by (e->>0)::int) from jsonb_array_elements(v_got) e)
                    = '136.37,136.37,136.37,136.37,136.36,136.36,136.36,136.36,136.36,136.36,136.36',
                'membership: season schedule unchanged (11 x on the 28th, 4 x 136.37 then 7 x 136.36, sum 1500) ' || v_got::text);

  -- A regular invoice plan chosen by a parent keeps the club rules (not the service rules).
  insert into public.payment_plan_settings (org_id, enabled, product_types, allowed_counts, schedule_kind, day_of_month)
  values (si.uid('org'), true, array['invoice'], array[2,3,6], 'monthly', 1)
  on conflict (org_id) do update set enabled = true, product_types = array['invoice'], allowed_counts = array[2,3,6], schedule_kind = 'monthly', day_of_month = 1,
                                     fee_kind = 'none', first_at_signup = false, min_amount = 0;
  insert into public.invoices (id, org_id, number, family_id, description, currency, status, due_date, total_chf, activity, activity_source)
  values (v_inv, si.uid('org'), 'SI-MANUAL-2', '00000000-0000-0000-0000-000000000061',
          'Synthetic season fee', 'CHF', 'sent', current_date + 30, 600, 'training', 'set');
  r := si.j(si.uid('guardian'), format('select public.plan_choose(%L, 6)::text', v_inv));
  perform si.ok(r->>'plan_id' is not null
                and (select source from public.payment_plans where id = (r->>'plan_id')::uuid) <> 'service'
                and si.amounts(v_inv) = '100.00,100.00,100.00,100.00,100.00,100.00'
                and si.dates(v_inv) = public.plan_due_dates(current_date, 6, false, 'monthly', 1, '{}'),
                'club plan: 6 payments allowed by the club rules (beyond the service maximum), dates from the club schedule '
                || coalesce(r->>'err', 'ok'));
end $$;

do $$
begin
  perform si.ok((select count(*) from public.payment_plans where invoice_id = '00000000-0000-0000-0000-0000000009e2') = 1,
                'club plan: the service trigger added nothing at commit');
end $$;
