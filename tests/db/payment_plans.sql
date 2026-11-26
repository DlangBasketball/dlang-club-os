-- ============================================================================
-- Instalment plans, recurring fees and autopay (migration 20250420101000).
--
-- Fixtures (seed): org A …0001 (admin …f1, finance …f2, parent …f4 = guardian
-- of family …061 with athlete …071), family …062 (athletes …072 b.2014 and
-- …073 b.2016). Created here: parent P2 (…a2) guardian of family …062, org B
-- (Riverside …0002) admin+finance …b1 with family …b61 and an invoice.
-- Every assertion prints PASS/FAIL; cross-tenant denial for every new table
-- and RPC; a parent only sees / manages their own family's plans and cards.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema pp;
grant usage on schema pp to authenticated, anon;

create function pp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

create function pp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  if p is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
end $$;

create function pp.as_super() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function pp.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform pp.as_user(p);
    execute p_sql into v_res;
    perform pp.as_super();
    return 'OK:' || coalesce(v_res, '<null>');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    perform pp.as_super();
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;
grant execute on all functions in schema pp to authenticated, anon;

create table pp.ctx (k text primary key, v text);
grant all on pp.ctx to authenticated, anon;
create function pp.get(p text) returns uuid language sql as $$ select v::uuid from pp.ctx where k = p $$;
grant execute on function pp.get(text) to authenticated, anon;

-- Identities ----------------------------------------------------------------
insert into auth.users (id, email) values
  ('b0000000-0000-0000-0000-0000000000b1', 'admin@riverside.test'),
  ('a0000000-0000-0000-0000-0000000000a2', 'parent2@example.test')
on conflict do nothing;
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000000b1';
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001' where id = 'a0000000-0000-0000-0000-0000000000a2';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', 'admin'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', 'finance')
on conflict do nothing;
insert into public.family_members (family_id, profile_id, relation, is_primary) values
  ('00000000-0000-0000-0000-000000000062', 'a0000000-0000-0000-0000-0000000000a2', 'father', true)
on conflict do nothing;
insert into public.families (id, org_id, name) values
  ('b0000000-0000-0000-0000-000000000b61', '10000000-0000-0000-0000-000000000002', 'B family')
on conflict do nothing;
update public.organizations set payment_settings = coalesce(payment_settings, '{}'::jsonb)
  || jsonb_build_object('stripe', jsonb_build_object('account_id', 'acct_clubA', 'charges_enabled', true))
 where id = '00000000-0000-0000-0000-000000000001';

-- Invoices: A1 (CHF 1000, family 061), A2 (CHF 600, family 061), B1 (org B)
do $$
declare v uuid;
begin
  insert into public.invoices (org_id, number, family_id, description, status, due_date, currency)
  values ('00000000-0000-0000-0000-000000000001', 'PP-A1', '00000000-0000-0000-0000-000000000061', 'Season', 'sent', current_date + 10, 'CHF')
  returning id into v;
  insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
  values ('00000000-0000-0000-0000-000000000001', v, 'Season fee', 1, 1000, 1000);
  update public.invoices set total_chf = 1000 where id = v;
  insert into pp.ctx values ('a1', v::text);

  insert into public.invoices (org_id, number, family_id, description, status, due_date, currency)
  values ('00000000-0000-0000-0000-000000000001', 'PP-A2', '00000000-0000-0000-0000-000000000061', 'Kit', 'sent', current_date + 10, 'CHF')
  returning id into v;
  update public.invoices set total_chf = 600 where id = v;
  insert into pp.ctx values ('a2', v::text);

  insert into public.invoices (org_id, number, family_id, description, status, due_date, currency)
  values ('10000000-0000-0000-0000-000000000002', 'PP-B1', 'b0000000-0000-0000-0000-000000000b61', 'B', 'sent', current_date + 10, 'CHF')
  returning id into v;
  update public.invoices set total_chf = 300 where id = v;
  insert into pp.ctx values ('b1', v::text);
end $$;

-- ===========================================================================
-- 1. Pure helpers (mirrored in src/lib/payments/plans.ts)
-- ===========================================================================
do $$
declare a numeric[]; d date[]; b record;
begin
  a := public.plan_split(100, 3, 'CHF');
  perform pp.ok(a = array[33.33, 33.33, 33.34]::numeric[], 'split 100/3: remainder on the LAST instalment (' || a::text || ')');
  a := public.plan_split(1000, 7, 'JPY');
  perform pp.ok(a[7] = 148 and a[1] = 142, 'split JPY in whole yen, remainder last (' || a::text || ')');
  d := public.plan_due_dates('2026-01-15', 3, false, 'monthly', 31, '{}');
  perform pp.ok(d = array['2026-01-31','2026-02-28','2026-03-31']::date[], 'monthly on day 31 clamps to month ends (' || d::text || ')');
  d := public.plan_due_dates('2026-01-15', 3, true, 'monthly', 15, '{}');
  perform pp.ok(d = array['2026-01-15','2026-02-15','2026-03-15']::date[], 'first payment at signup = today, then day 15 (' || d::text || ')');
  d := public.plan_due_dates('2026-01-15', 2, false, 'monthly', 10, '{}');
  perform pp.ok(d = array['2026-02-10','2026-03-10']::date[], 'day already passed this month starts next month');
  d := public.plan_due_dates('2026-01-15', 2, false, 'custom', 1, array['2026-03-01','2026-01-10','2026-02-01']::date[]);
  perform pp.ok(d = array['2026-02-01','2026-03-01']::date[], 'custom dates: future ones, ascending');
  perform pp.ok(public.plan_due_dates('2026-01-15', 3, false, 'custom', 1, array['2026-02-01']::date[]) is null, 'custom: not enough dates -> null');
  perform pp.ok(public.plan_fee('percent', 2.5, 1000, 'CHF') = 25 and public.plan_fee('fixed', 10, 1000, 'CHF') = 10
                and public.plan_fee('none', 5, 1000, 'CHF') = 0, 'instalment fee: percent / fixed / none');
  perform pp.ok(public.recurring_prorate(120, '2026-09-01', '2026-09-30', '2026-09-16', 'daily', 'CHF') = 60, 'daily proration 15/30 days');
  perform pp.ok(public.recurring_prorate(120, '2026-09-01', '2026-09-30', '2026-09-16', 'half_month', 'CHF') = 60
                and public.recurring_prorate(120, '2026-09-01', '2026-09-30', '2026-09-10', 'half_month', 'CHF') = 120, 'half-month proration');
  perform pp.ok(public.recurring_prorate(120, '2026-09-01', '2026-09-30', '2026-09-16', 'none', 'CHF') = 120, 'no proration');
  select * into b from public.recurring_period_bounds('2026-08-01', 31, 'monthly', '2026-09-15');
  perform pp.ok(b.period_start = '2026-08-31' and b.period_end = '2026-09-29', 'period bounds with billing day 31 (' || b.period_start || '..' || b.period_end || ')');
  select * into b from public.recurring_period_bounds('2026-08-01', 1, 'quarterly', '2026-12-20');
  perform pp.ok(b.period_start = '2026-11-01' and b.period_end = '2027-01-31', 'quarterly period bounds');
end $$;

-- ===========================================================================
-- 2. Settings: RLS per verb + cross-tenant
-- ===========================================================================
do $$
declare v text;
begin
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4',
    $q$insert into public.payment_plan_settings (org_id, enabled) values ('00000000-0000-0000-0000-000000000001', true) returning 'x'$q$);
  perform pp.ok(v like 'ERR:%row-level security%', 'parent cannot write instalment settings (' || v || ')');
  v := pp.run_as('b0000000-0000-0000-0000-0000000000b1',
    $q$insert into public.payment_plan_settings (org_id, enabled) values ('00000000-0000-0000-0000-000000000001', true) returning 'x'$q$);
  perform pp.ok(v like 'ERR:%row-level security%', 'org B finance cannot write org A settings');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2',
    $q$insert into public.payment_plan_settings (org_id, enabled) values ('00000000-0000-0000-0000-000000000001', false) returning 'x'$q$);
  perform pp.ok(v = 'OK:x', 'finance saves the club settings (' || v || ')');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.payment_plan_settings$q$);
  perform pp.ok(v = 'OK:1', 'parent reads own club instalment rules');
  v := pp.run_as('b0000000-0000-0000-0000-0000000000b1', $q$select count(*)::text from public.payment_plan_settings$q$);
  perform pp.ok(v = 'OK:0', 'org B cannot read org A settings');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2', $q$delete from public.payment_plan_settings returning 'x'$q$);
  perform pp.ok(v = 'OK:<null>' and exists (select 1 from public.payment_plan_settings), 'settings are never deleted');
end $$;

-- ===========================================================================
-- 3. Parent chooses instalments on an open invoice
-- ===========================================================================
do $$
declare v text; v_plan uuid; r record; n int; s numeric; v_fee numeric;
begin
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.plan_choose(%L, 3)::text$q$, pp.get('a1')));
  perform pp.ok(v like 'ERR:%PLANS_DISABLED%', 'disabled -> PLANS_DISABLED (' || v || ')');

  update public.payment_plan_settings
     set enabled = true, product_types = '{season,camp}', allowed_counts = '{2,3}', min_amount = 200,
         fee_kind = 'percent', fee_value = 2, schedule_kind = 'monthly', day_of_month = 28,
         autopay_enabled = false, retry_days = '{3,7}'
   where org_id = '00000000-0000-0000-0000-000000000001';

  v := pp.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.plan_choose(%L, 3)::text$q$, pp.get('a1')));
  perform pp.ok(v like 'ERR:%PRODUCT_NOT_ELIGIBLE%', 'invoice without programme is not eligible unless "invoice" is enabled (' || v || ')');
  update public.payment_plan_settings set product_types = '{season,invoice}' where org_id = '00000000-0000-0000-0000-000000000001';
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.plan_choose(%L, 4)::text$q$, pp.get('a1')));
  perform pp.ok(v like 'ERR:%COUNT_NOT_ALLOWED%', 'count not offered -> COUNT_NOT_ALLOWED');
  v := pp.run_as('a0000000-0000-0000-0000-0000000000a2', format($q$select public.plan_choose(%L, 3)::text$q$, pp.get('a1')));
  perform pp.ok(v like 'ERR:%INVOICE_NOT_FOUND%', 'another family''s parent cannot split this invoice');
  v := pp.run_as('b0000000-0000-0000-0000-0000000000b1', format($q$select public.plan_choose(%L, 3)::text$q$, pp.get('a1')));
  perform pp.ok(v like 'ERR:%INVOICE_NOT_FOUND%', 'org B finance cannot split an org A invoice');

  v := pp.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.plan_choose(%L, 3)->>'plan_id'$q$, pp.get('a1')));
  perform pp.ok(v like 'OK:%' and v <> 'OK:<null>', 'parent splits invoice into 3 (' || v || ')');
  v_plan := substr(v, 4)::uuid;
  insert into pp.ctx values ('plan1', v_plan::text);

  select count(*), sum(amount) into n, s from public.payment_plan_installments where plan_id = v_plan;
  perform pp.ok(n = 3 and s = 1020, '3 instalments summing to balance + 2% fee = 1020 (' || s || ')');
  perform pp.ok((select array_agg(amount order by seq) from public.payment_plan_installments where plan_id = v_plan) = array[340,340,340]::numeric[],
                'equal split');
  select fee_amount into v_fee from public.payment_plans where id = v_plan;
  perform pp.ok(v_fee = 20 and exists (select 1 from public.invoice_adjustments a join public.payment_plans p on p.fee_adjustment_id = a.id
                                        where p.id = v_plan and a.kind = 'debit_note' and a.amount = 20 and a.voided_at is null),
                'fee is a debit note on the invoice (issued total untouched)');
  perform pp.ok((select total_chf from public.invoices where id = pp.get('a1')) = 1000, 'issued total unchanged');
  perform pp.ok((select due_date from public.invoices where id = pp.get('a1'))
                = (select max(due_date) from public.payment_plan_installments where plan_id = v_plan), 'invoice due date = last instalment');
  perform pp.ok((select bool_and(extract(day from due_date) = 28 or due_date = (date_trunc('month', due_date) + interval '1 month - 1 day')::date)
                   from public.payment_plan_installments where plan_id = v_plan), 'instalments on the club''s day of month');
  perform pp.ok(exists (select 1 from public.audit_logs where action = 'PAYMENT_PLAN_CREATED' and target_id = v_plan), 'creation audited');

  v := pp.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.plan_choose(%L, 2)::text$q$, pp.get('a1')));
  perform pp.ok(v like 'ERR:%PLAN_EXISTS%', 'one active plan per invoice');
  update public.payment_plan_settings set min_amount = 700 where org_id = '00000000-0000-0000-0000-000000000001';
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.plan_choose(%L, 2)::text$q$, pp.get('a2')));
  perform pp.ok(v like 'ERR:%BELOW_MINIMUM%', 'minimum invoice amount enforced');
  update public.payment_plan_settings set min_amount = 0 where org_id = '00000000-0000-0000-0000-000000000001';
end $$;

-- Visibility of plans / instalments
do $$
declare v text;
begin
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.payment_plan_installments$q$);
  perform pp.ok(v = 'OK:3', 'parent sees own family instalments (' || v || ')');
  v := pp.run_as('a0000000-0000-0000-0000-0000000000a2', $q$select count(*)::text from public.payment_plans where kind = 'installments'$q$);
  perform pp.ok(v = 'OK:0', 'another parent sees none of family 061''s plans');
  v := pp.run_as('b0000000-0000-0000-0000-0000000000b1', $q$select count(*)::text from public.payment_plan_installments$q$);
  perform pp.ok(v = 'OK:0', 'org B sees no org A instalments');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4',
    format($q$update public.payment_plan_installments set amount = 1 where plan_id = %L returning 'x'$q$, pp.get('plan1')));
  perform pp.ok(v = 'OK:<null>', 'parent cannot edit instalments directly');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$delete from public.payment_plans where id = %L returning 'x'$q$, pp.get('plan1')));
  perform pp.ok(v = 'OK:<null>' and exists (select 1 from public.payment_plans where id = pp.get('plan1')), 'plans are never deleted (even by finance)');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select (public.plan_invoice_context(%L))->>'product_type'$q$, pp.get('a1')));
  perform pp.ok(v = 'OK:other', 'invoice context for its parent (' || v || ')');
  v := pp.run_as('a0000000-0000-0000-0000-0000000000a2', format($q$select public.plan_invoice_context(%L)::text$q$, pp.get('a1')));
  perform pp.ok(v = 'OK:<null>', 'invoice context hidden from other families');
end $$;

-- ===========================================================================
-- 4. Allocation: earliest open instalment first, overpayment rolls forward
-- ===========================================================================
do $$
declare r record;
begin
  perform public.apply_stripe_payment(pp.get('a1'), 400, 'pi_pp_1');
  select array_agg(status order by seq) st, array_agg(amount_paid order by seq) ap into r
    from public.payment_plan_installments where plan_id = pp.get('plan1');
  perform pp.ok(r.st = array['paid','scheduled','scheduled'] and r.ap = array[340,60,0]::numeric[],
                '400 paid: #1 paid, 60 rolled to #2 (' || r.st::text || ' ' || r.ap::text || ')');
  perform public.apply_stripe_payment(pp.get('a1'), 300, 'pi_pp_2');
  select array_agg(status order by seq) st, array_agg(amount_paid order by seq) ap into r
    from public.payment_plan_installments where plan_id = pp.get('plan1');
  perform pp.ok(r.st = array['paid','paid','scheduled'] and r.ap = array[340,340,20]::numeric[], 'second payment completes #2, rest on #3');
end $$;

-- ===========================================================================
-- 5. Reschedule / amounts (finance), keeping the total
-- ===========================================================================
do $$
declare v text; v_i2 uuid; v_i3 uuid;
begin
  select id into v_i2 from public.payment_plan_installments where plan_id = pp.get('plan1') and seq = 2;
  select id into v_i3 from public.payment_plan_installments where plan_id = pp.get('plan1') and seq = 3;
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.plan_reschedule(%L, %L::jsonb)::text$q$, pp.get('plan1'),
           jsonb_build_array(jsonb_build_object('id', v_i2, 'amount', 100))));
  perform pp.ok(v like 'ERR:%INSTALMENT_LOCKED%', 'paid instalment cannot be edited');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.plan_reschedule(%L, %L::jsonb)::text$q$, pp.get('plan1'),
           jsonb_build_array(jsonb_build_object('id', v_i3, 'amount', 300))));
  perform pp.ok(v like 'ERR:%TOTAL_MISMATCH%', 'changing amounts must keep the total');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.plan_reschedule(%L, %L::jsonb, 'family request')::text$q$, pp.get('plan1'),
           jsonb_build_array(jsonb_build_object('id', v_i3, 'due_date', (current_date + 200)::text))));
  perform pp.ok(v like 'OK:%', 'reschedule the last instalment (' || v || ')');
  perform pp.ok((select due_date from public.invoices where id = pp.get('a1')) = current_date + 200, 'invoice due follows the new last date');
  perform pp.ok(exists (select 1 from public.audit_logs where action = 'PAYMENT_PLAN_RESCHEDULED' and target_id = pp.get('plan1')), 'reschedule audited');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4',
    format($q$select public.plan_reschedule(%L, '[]'::jsonb)::text$q$, pp.get('plan1')));
  perform pp.ok(v like 'ERR:%PLAN_NOT_FOUND%', 'parent cannot reschedule');
  v := pp.run_as('b0000000-0000-0000-0000-0000000000b1',
    format($q$select public.plan_set_paused(%L, true)::text$q$, pp.get('plan1')));
  perform pp.ok(v like 'ERR:%PLAN_NOT_FOUND%', 'org B cannot pause an org A plan');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.plan_set_paused(%L, true, 'holiday')->>'status'$q$, pp.get('plan1')));
  perform pp.ok(v = 'OK:paused', 'finance pauses a plan');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.plan_set_paused(%L, false)->>'status'$q$, pp.get('plan1')));
  perform pp.ok(v = 'OK:active', 'and resumes it');
end $$;

-- ===========================================================================
-- 6. Admin custom plan + cancel returns the invoice to normal balance
-- ===========================================================================
do $$
declare v text; v_plan uuid; v_due date;
begin
  select due_date into v_due from public.invoices where id = pp.get('a2');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.plan_admin_create(%L, array[%L, %L]::date[], array[300, 290]::numeric[], 0)::text$q$,
           pp.get('a2'), current_date + 5, current_date + 35));
  perform pp.ok(v like 'ERR:%TOTAL_MISMATCH%', 'admin schedule must add up to the balance');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.plan_admin_create(%L, array[%L, %L]::date[], array[310, 300]::numeric[], 10)->>'plan_id'$q$,
           pp.get('a2'), current_date + 5, current_date + 35));
  perform pp.ok(v like 'OK:%' and v <> 'OK:<null>', 'admin custom plan with a CHF 10 fee (' || v || ')');
  v_plan := substr(v, 4)::uuid;
  v := pp.run_as('b0000000-0000-0000-0000-0000000000b1',
    format($q$select public.plan_cancel(%L, 'x')::text$q$, v_plan));
  perform pp.ok(v like 'ERR:%PLAN_NOT_FOUND%', 'org B cannot cancel it');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.plan_cancel(%L, 'family paid in full')->>'status'$q$, v_plan));
  perform pp.ok(v = 'OK:cancelled', 'finance cancels the plan');
  perform pp.ok((select bool_and(status = 'cancelled') from public.payment_plan_installments where plan_id = v_plan), 'unpaid instalments cancelled');
  perform pp.ok((select adjustments_total from public.invoices where id = pp.get('a2')) = 0, 'fee debit note voided: normal balance again');
  perform pp.ok((select due_date from public.invoices where id = pp.get('a2')) = v_due, 'original due date restored');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.plan_admin_create(%L, array[%L]::date[], array[300]::numeric[], 0)::text$q$, pp.get('b1'), current_date));
  perform pp.ok(v like 'ERR:%INVOICE_NOT_FOUND%', 'org A finance cannot plan an org B invoice');
end $$;

-- Service-only checkout attach
do $$
declare v text;
begin
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4',
    format($q$select public.plan_attach_checkout('00000000-0000-0000-0000-000000000001', %L, 2, 'camp')::text$q$, pp.get('a2')));
  perform pp.ok(v like 'ERR:%permission denied%' or v like 'ERR:%NOT_AUTHORIZED%', 'plan_attach_checkout is service-only (' || left(v, 60) || ')');
  v := (select public.plan_attach_checkout('00000000-0000-0000-0000-000000000001', pp.get('b1'), 2, 'camp')::text);
  perform pp.ok(false, 'attach with the wrong org must fail');
exception when others then
  perform pp.ok(sqlerrm like '%INVOICE_NOT_FOUND%', 'attach checks the invoice belongs to the resolved org (' || sqlerrm || ')');
end $$;
do $$
declare j jsonb;
begin
  j := public.plan_attach_checkout('00000000-0000-0000-0000-000000000001', pp.get('a2'), 2, 'shop');
  perform pp.ok(j ? 'plan_id' and (select source from public.payment_plans where id = (j->>'plan_id')::uuid) = 'shop', 'service attaches a plan at checkout');
  insert into pp.ctx values ('plan2', j->>'plan_id');
end $$;

-- ===========================================================================
-- 7. Recurring fees: templates, enrolment, generation, pauses, skip, discounts
-- ===========================================================================
do $$
declare v text; v_tpl uuid; n int; r record;
begin
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2',
    $q$insert into public.recurring_fee_templates (org_id, name, amount, currency, frequency, billing_day, start_date, proration, due_days)
       values ('00000000-0000-0000-0000-000000000001', 'U14 monthly fee', 120, 'CHF', 'monthly', 1, '2026-09-01', 'daily', 10) returning id::text$q$);
  perform pp.ok(v like 'OK:%', 'finance creates a recurring fee template');
  v_tpl := substr(v, 4)::uuid;
  insert into pp.ctx values ('tpl', v_tpl::text);
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.recurring_fee_templates$q$);
  perform pp.ok(v = 'OK:0', 'parents do not read templates');
  v := pp.run_as('b0000000-0000-0000-0000-0000000000b1', $q$select count(*)::text from public.recurring_fee_templates$q$);
  perform pp.ok(v = 'OK:0', 'org B cannot read org A templates');
  v := pp.run_as('b0000000-0000-0000-0000-0000000000b1',
    $q$insert into public.recurring_fee_templates (org_id, name, amount, currency, start_date) values ('00000000-0000-0000-0000-000000000001', 'x', 1, 'CHF', '2026-01-01') returning 'x'$q$);
  perform pp.ok(v like 'ERR:%row-level security%', 'org B cannot create org A templates');
  v := pp.run_as('b0000000-0000-0000-0000-0000000000b1',
    format($q$select public.recurring_enrol(%L, array['00000000-0000-0000-0000-000000000072']::uuid[], '2026-09-01')::text$q$, v_tpl));
  perform pp.ok(v like 'ERR:%TEMPLATE_NOT_FOUND%', 'org B cannot enrol into an org A template');

  -- sibling discount: 2nd child 50%
  insert into public.discounts (org_id, name, kind, value, scope, rule, sibling_min_position)
  values ('00000000-0000-0000-0000-000000000001', 'Sibling', 'percent', 50, 'all', 'sibling', 2);

  -- family 062: Lucas (2014) from 1 Sep, Sophia (2016) joins 16 Sep (daily proration)
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.recurring_enrol(%L, array['00000000-0000-0000-0000-000000000072']::uuid[], '2026-09-01')::text$q$, v_tpl));
  perform pp.ok(v = 'OK:1', 'enrol one athlete');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.recurring_enrol(%L, array['00000000-0000-0000-0000-000000000073', '00000000-0000-0000-0000-000000000072']::uuid[], '2026-09-16')::text$q$, v_tpl));
  perform pp.ok(v = 'OK:1', 'bulk enrol skips athletes already enrolled');

  -- preview does not write
  select count(*) into n from public.recurring_generate('00000000-0000-0000-0000-000000000001', '2026-10-05', true);
  perform pp.ok(n = 4 and not exists (select 1 from public.payment_plan_installments i join public.payment_plans p on p.id = i.plan_id
                                       where p.template_id = v_tpl), 'dry run previews 4 periods without writing (' || n || ')');

  n := public.run_recurring_billing('00000000-0000-0000-0000-000000000001', '2026-10-05');
  perform pp.ok(n = 4, 'two periods for each child invoiced (' || n || ')');
  n := public.run_recurring_billing('00000000-0000-0000-0000-000000000001', '2026-10-05');
  perform pp.ok(n = 0, 'idempotent per period');
  select i.amount into r from public.payment_plan_installments i join public.payment_plans p on p.id = i.plan_id
   where p.template_id = v_tpl and p.athlete_id = '00000000-0000-0000-0000-000000000073' and i.period_start = '2026-09-01';
  perform pp.ok(r.amount = 30, 'Sophia: Sep prorated 15/30 days = 60, sibling 50% -> 30 (' || r.amount || ')');
  select i.amount into r from public.payment_plan_installments i join public.payment_plans p on p.id = i.plan_id
   where p.template_id = v_tpl and p.athlete_id = '00000000-0000-0000-0000-000000000072' and i.period_start = '2026-10-01';
  perform pp.ok(r.amount = 120, 'eldest child pays full fee (' || r.amount || ')');
  select i.amount into r from public.payment_plan_installments i join public.payment_plans p on p.id = i.plan_id
   where p.template_id = v_tpl and p.athlete_id = '00000000-0000-0000-0000-000000000073' and i.period_start = '2026-10-01';
  perform pp.ok(r.amount = 60, 'second child sibling discount (' || r.amount || ')');
  perform pp.ok((select count(*) from public.invoices i join public.payment_plan_installments x on x.invoice_id = i.id
                  join public.payment_plans p on p.id = x.plan_id where p.template_id = v_tpl and i.status::text = 'sent'
                  and i.due_date = x.period_start + 10) = 4, 'period invoices issued, due period start + due days');

  v := pp.run_as('a0000000-0000-0000-0000-0000000000a2', $q$select count(*)::text from public.payment_plans where kind = 'recurring'$q$);
  perform pp.ok(v = 'OK:2', 'parent of family 062 sees their two enrolments');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select count(*)::text from public.payment_plans where template_id = %L$q$, v_tpl));
  perform pp.ok(v = 'OK:0', 'parent of family 061 sees none of them');
end $$;

do $$
declare v text; v_plan uuid; n int;
begin
  select id into v_plan from public.payment_plans where template_id = pp.get('tpl') and athlete_id = '00000000-0000-0000-0000-000000000072';
  insert into pp.ctx values ('rplan', v_plan::text);
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.recurring_add_pause(%L, '2026-11-01', '2026-11-30', 'injury')::text$q$, v_plan));
  perform pp.ok(v like 'OK:%', 'finance adds an injury pause');
  v := pp.run_as('a0000000-0000-0000-0000-0000000000a2', $q$select count(*)::text from public.recurring_plan_pauses$q$);
  perform pp.ok(v = 'OK:1', 'family sees its own pause');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.recurring_plan_pauses$q$);
  perform pp.ok(v = 'OK:0', 'other family does not');
  v := pp.run_as('b0000000-0000-0000-0000-0000000000b1', $q$select count(*)::text from public.recurring_plan_pauses$q$);
  perform pp.ok(v = 'OK:0', 'org B does not');
  v := pp.run_as('b0000000-0000-0000-0000-0000000000b1',
    format($q$select public.recurring_add_pause(%L, '2026-11-01', '2026-11-30', 'holiday')::text$q$, v_plan));
  perform pp.ok(v like 'ERR:%PLAN_NOT_FOUND%', 'org B cannot pause org A enrolments');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.recurring_skip_period(%L, '2026-12-01', 'Christmas break')::text$q$, v_plan));
  perform pp.ok(v like 'OK:%', 'skip a future period');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.recurring_skip_period(%L, '2026-12-15', 'x')::text$q$, v_plan));
  perform pp.ok(v like 'ERR:%INVALID_PERIOD%', 'skip needs a period start');
  n := public.run_recurring_billing('00000000-0000-0000-0000-000000000001', '2027-01-02');
  perform pp.ok((select status from public.payment_plan_installments where plan_id = v_plan and period_start = '2026-11-01') = 'skipped'
                and (select skipped_reason from public.payment_plan_installments where plan_id = v_plan and period_start = '2026-11-01') = 'pause:injury',
                'paused period recorded as skipped, no invoice');
  perform pp.ok((select invoice_id from public.payment_plan_installments where plan_id = v_plan and period_start = '2026-12-01') is null,
                'skipped period never invoiced');
  perform pp.ok((select count(*) from public.payment_plan_installments where plan_id = v_plan and period_start = '2027-01-01' and invoice_id is not null) = 1,
                'January invoiced');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.recurring_end(%L, '2027-01-31')::text$q$, v_plan));
  perform pp.ok(v like 'OK:%' and (select status from public.payment_plans where id = v_plan) = 'completed', 'end enrolment');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4',
    format($q$select public.run_recurring_billing('00000000-0000-0000-0000-000000000001')::text$q$));
  perform pp.ok(v like 'ERR:%NOT_AUTHORIZED%', 'parents cannot run billing');
  v := pp.run_as('b0000000-0000-0000-0000-0000000000b1',
    $q$select count(*)::text from public.recurring_generate('00000000-0000-0000-0000-000000000001', current_date, true)$q$);
  perform pp.ok(v like 'ERR:%NOT_AUTHORIZED%', 'org B cannot preview org A billing');
end $$;

-- ===========================================================================
-- 8. Autopay: consent, activation, charges, retries, fallback
-- ===========================================================================
do $$
declare v text; j jsonb; v_m uuid; v_i uuid;
begin
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4',
    $q$select public.autopay_start_setup('00000000-0000-0000-0000-000000000061', '1', 'I authorise the club to charge my saved card for instalments.')::text$q$);
  perform pp.ok(v like 'ERR:%AUTOPAY_DISABLED%', 'autopay off by default');
  update public.payment_plan_settings set autopay_enabled = true, mandate_version = '2' where org_id = '00000000-0000-0000-0000-000000000001';
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4',
    $q$select public.autopay_start_setup('00000000-0000-0000-0000-000000000061', '1', 'I authorise the club to charge my saved card for instalments.')::text$q$);
  perform pp.ok(v like 'ERR:%CONSENT_OUTDATED%', 'consent must be the current wording version');
  v := pp.run_as('a0000000-0000-0000-0000-0000000000a2',
    $q$select public.autopay_start_setup('00000000-0000-0000-0000-000000000061', '2', 'I authorise the club to charge my saved card for instalments.')::text$q$);
  perform pp.ok(v like 'ERR:%FAMILY_NOT_FOUND%', 'a parent cannot save a card for another family');
  v := pp.run_as('b0000000-0000-0000-0000-0000000000b1',
    $q$select public.autopay_start_setup('00000000-0000-0000-0000-000000000061', '2', 'I authorise the club to charge my saved card for instalments.')::text$q$);
  perform pp.ok(v like 'ERR:%FAMILY_NOT_FOUND%', 'org B cannot open a mandate for an org A family');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4',
    $q$insert into public.autopay_mandates (org_id, family_id, consent_version, consent_text) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000061', '2', 'aaaaaaaaaaaaaaaaaaaaaaaa') returning 'x'$q$);
  perform pp.ok(v like 'ERR:%row-level security%', 'mandates cannot be inserted directly');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4',
    $q$select public.autopay_start_setup('00000000-0000-0000-0000-000000000061', '2', 'I authorise the club to charge my saved card for instalments.')->>'mandate_id'$q$);
  perform pp.ok(v like 'OK:%' and v <> 'OK:<null>', 'guardian records consent and opens a pending mandate');
  v_m := substr(v, 4)::uuid;
  insert into pp.ctx values ('mandate', v_m::text);
  perform pp.ok((select consented_by = '00000000-0000-0000-0000-0000000000f4' and consent_version = '2' and consented_at is not null
                   from public.autopay_mandates where id = v_m), 'consent: who, version, timestamp recorded');

  v := pp.run_as('00000000-0000-0000-0000-0000000000f4',
    format($q$select public.autopay_activate(%L, 'acct_clubA', 'cus_X', 'pm_X', 'visa', '4242', 12, 2030)::text$q$, v_m));
  perform pp.ok(v like 'ERR:%permission denied%' or v like 'ERR:%NOT_AUTHORIZED%', 'activation is service-only');
  perform public.autopay_attach_session(v_m, '00000000-0000-0000-0000-000000000001', 'cus_X', 'cs_test_1', 'acct_clubA');
  begin
    perform public.autopay_activate(v_m, 'acct_other', 'cus_X', 'pm_X', 'visa', '4242', 12, 2030);
    perform pp.ok(false, 'activation from another connected account must fail');
  exception when others then
    perform pp.ok(sqlerrm like '%ACCOUNT_MISMATCH%', 'activation checks the connected account');
  end;
  j := public.autopay_activate(v_m, 'acct_clubA', 'cus_X', 'pm_X', 'visa', '4242', 12, 2030);
  perform pp.ok((select status = 'active' and card_last4 = '4242' from public.autopay_mandates where id = v_m), 'mandate active with display-only card details');
  j := public.autopay_activate(v_m, 'acct_clubA', 'cus_X', 'pm_X', 'visa', '4242', 12, 2030);
  perform pp.ok((j->>'duplicate')::boolean, 'activation is idempotent (webhook redelivery)');
  perform pp.ok(not exists (select 1 from public.audit_logs where target_table = 'autopay_mandates'
                             and (coalesce(new_data, '{}') ? 'card_last4' or coalesce(new_data, '{}') ? 'stripe_payment_method_id'
                                  or coalesce(old_data, '{}') ? 'card_last4')),
                'audit_logs carry no card details for mandates');
  perform pp.ok(exists (select 1 from public.audit_logs where target_table = 'autopay_mandates' and target_id = v_m), 'mandate lifecycle audited');

  v := pp.run_as('a0000000-0000-0000-0000-0000000000a2', $q$select count(*)::text from public.autopay_mandates$q$);
  perform pp.ok(v = 'OK:0', 'another parent cannot see this family''s card');
  v := pp.run_as('b0000000-0000-0000-0000-0000000000b1', $q$select count(*)::text from public.autopay_mandates$q$);
  perform pp.ok(v = 'OK:0', 'org B cannot see org A mandates');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.autopay_mandates where status = 'active'$q$);
  perform pp.ok(v = 'OK:1', 'the guardian sees their card');
  v := pp.run_as('a0000000-0000-0000-0000-0000000000a2', format($q$select public.autopay_set_enabled(%L, false)::text$q$, v_m));
  perform pp.ok(v like 'ERR:%MANDATE_NOT_FOUND%', 'another parent cannot toggle it');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.autopay_set_enabled(%L, false)->>'enabled'$q$, v_m));
  perform pp.ok(v = 'OK:false', 'guardian turns autopay off');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.autopay_set_enabled(%L, true)->>'enabled'$q$, v_m));
  perform pp.ok(v = 'OK:true', 'and on again');
end $$;

-- Charges on the plan2 instalments (family 061)
do $$
declare v text; j jsonb; v_i uuid; d date := current_date; w jsonb;
begin
  update public.payment_plan_installments set due_date = d where plan_id = pp.get('plan2') and seq = 1;
  select id into v_i from public.payment_plan_installments where plan_id = pp.get('plan2') and seq = 1;
  insert into pp.ctx values ('inst', v_i::text);

  v := pp.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.plans_cron_work('00000000-0000-0000-0000-000000000001')::text$q$);
  perform pp.ok(v like 'ERR:%permission denied%' or v like 'ERR:%NOT_AUTHORIZED%', 'cron work list is service-only');
  w := public.plans_cron_work('00000000-0000-0000-0000-000000000001', d);
  perform pp.ok(exists (select 1 from jsonb_array_elements(w->'charges') x where (x->>'installment_id')::uuid = v_i), 'due instalment listed for autopay');

  v := pp.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.autopay_begin_charge(%L)::text$q$, v_i));
  perform pp.ok(v like 'ERR:%permission denied%' or v like 'ERR:%NOT_AUTHORIZED%', 'charging is service-only');
  j := public.autopay_begin_charge(v_i, d);
  perform pp.ok(j->>'idempotency_key' = 'autopay:' || v_i || ':1' and (j->>'amount')::numeric = 306, 'attempt 1 for 306 (600 + 2% fee, halved), idempotency key per instalment + attempt (' || coalesce(j::text, 'null') || ')');
  perform pp.ok(public.autopay_begin_charge(v_i, d) is null, 'no second charge while one is processing');
  begin
    perform public.autopay_charge_result((j->>'charge_id')::uuid, 'pi_ap_1', 'failed', 'card_declined', 'insufficient_funds', 'acct_evil', d);
    perform pp.ok(false, 'result from another account must fail');
  exception when others then
    perform pp.ok(sqlerrm like '%ACCOUNT_MISMATCH%', 'charge result checks the connected account');
  end;
  j := public.autopay_charge_result((j->>'charge_id')::uuid, 'pi_ap_1', 'failed', 'card_declined', 'insufficient_funds', 'acct_clubA', d);
  perform pp.ok((j->>'next_retry_on')::date = d + 3 and not (j->>'fallback')::boolean, 'declined: retry in 3 days');
  j := public.autopay_charge_result(null, 'pi_ap_1', 'failed', 'card_declined', null, 'acct_clubA', d);
  perform pp.ok(not (j->>'transitioned')::boolean, 'webhook redelivery of the same result is a no-op');
  perform pp.ok(public.autopay_begin_charge(v_i, d + 1) is null, 'not retried before the retry date');
  j := public.autopay_begin_charge(v_i, d + 3);
  perform pp.ok((j->>'attempt')::int = 2, 'attempt 2 on day +3');
  j := public.autopay_charge_result((j->>'charge_id')::uuid, 'pi_ap_2', 'failed', 'card_declined', null, null, d + 3);
  perform pp.ok((j->>'next_retry_on')::date = d + 7, 'second retry on day +7');
  j := public.autopay_begin_charge(v_i, d + 7);
  j := public.autopay_charge_result((j->>'charge_id')::uuid, 'pi_ap_3', 'failed', 'card_declined', null, null, d + 7);
  perform pp.ok((j->>'fallback')::boolean, 'third failure falls back to QR-bill + reminder');
  perform pp.ok(public.autopay_begin_charge(v_i, d + 30) is null, 'no more automatic attempts after fallback');
  perform pp.ok((select autopay_status from public.payment_plan_installments where id = v_i) = 'fallback', 'instalment shows the fallback');

  v := pp.run_as('a0000000-0000-0000-0000-0000000000a2', $q$select count(*)::text from public.autopay_charges$q$);
  perform pp.ok(v = 'OK:0', 'other family cannot see the failed charges');
  v := pp.run_as('b0000000-0000-0000-0000-0000000000b1', $q$select count(*)::text from public.autopay_charges$q$);
  perform pp.ok(v = 'OK:0', 'org B cannot see org A charges');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.autopay_charges$q$);
  perform pp.ok(v = 'OK:3', 'the family sees its charge history');

  v := pp.run_as('b0000000-0000-0000-0000-0000000000b1', format($q$select public.autopay_retry_now(%L)::text$q$, v_i));
  perform pp.ok(v like 'ERR:%INSTALMENT_NOT_FOUND%', 'org B cannot retry');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.autopay_retry_now(%L)::text$q$, v_i));
  perform pp.ok(v like 'OK:%', 'finance retries a failed charge');
  j := public.autopay_begin_charge(v_i, d + 8);
  perform pp.ok((j->>'attempt')::int = 4 and j->>'idempotency_key' = 'autopay:' || v_i || ':4', 'fresh round keeps keys unique (attempt 4)');
  j := public.autopay_charge_result((j->>'charge_id')::uuid, 'pi_ap_4', 'requires_action', 'authentication_required', null, null, d + 8);
  perform pp.ok((select autopay_status from public.payment_plan_installments where id = v_i) = 'requires_action', '3DS needed: parent gets a link');
  perform pp.ok(public.autopay_begin_charge(v_i, d + 9) is null, 'requires_action is not retried off-session');

  -- payment succeeds on-session: instalment paid
  perform public.apply_stripe_payment(pp.get('a2'), 306, 'pi_ap_4');
  perform pp.ok((select status from public.payment_plan_installments where id = v_i) = 'paid', 'payment marks the instalment paid');

  -- Stripe detaches the card
  perform public.autopay_payment_method_event('acct_clubA', 'pm_X', true);
  perform pp.ok((select status from public.autopay_mandates where id = pp.get('mandate')) = 'detached', 'payment_method.detached deactivates the mandate');
end $$;

-- Revoke by guardian
do $$
declare v text; v_m uuid;
begin
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4',
    $q$select public.autopay_start_setup('00000000-0000-0000-0000-000000000061', '2', 'I authorise the club to charge my saved card for instalments.')->>'mandate_id'$q$);
  v_m := substr(v, 4)::uuid;
  perform pp.ok((select stripe_customer_id from public.autopay_mandates where id = v_m) = 'cus_X', 'new mandate re-uses the family''s Stripe customer');
  perform public.autopay_activate(v_m, 'acct_clubA', 'cus_X', 'pm_Y', 'mastercard', '5555', 1, 2031);
  v := pp.run_as('a0000000-0000-0000-0000-0000000000a2', format($q$select public.autopay_revoke(%L)::text$q$, v_m));
  perform pp.ok(v like 'ERR:%MANDATE_NOT_FOUND%', 'another parent cannot remove the card');
  v := pp.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.autopay_revoke(%L)->>'payment_method'$q$, v_m));
  perform pp.ok(v = 'OK:pm_Y', 'guardian removes the card (server detaches it in Stripe)');
  perform pp.ok((select status from public.autopay_mandates where id = v_m) = 'revoked', 'mandate revoked');
end $$;

-- ===========================================================================
-- 9. EXECUTE: anon has none of the new RPCs
-- ===========================================================================
do $$
declare f text;
begin
  foreach f in array array[
    'public.plan_choose(uuid, integer)', 'public.plan_admin_create(uuid, date[], numeric[], numeric)',
    'public.plan_reschedule(uuid, jsonb, text)', 'public.plan_cancel(uuid, text)', 'public.plan_set_paused(uuid, boolean, text)',
    'public.plan_attach_checkout(uuid, uuid, integer, text)', 'public.plan_invoice_context(uuid)',
    'public.recurring_enrol(uuid, uuid[], date, numeric)', 'public.recurring_generate(uuid, date, boolean)',
    'public.recurring_skip_period(uuid, date, text)', 'public.autopay_start_setup(uuid, text, text)',
    'public.autopay_activate(uuid, text, text, text, text, text, integer, integer)',
    'public.autopay_begin_charge(uuid, date)', 'public.autopay_charge_result(uuid, text, text, text, text, text, date)',
    'public.plans_cron_work(uuid, date)'
  ] loop
    perform pp.ok(not has_function_privilege('anon', f::regprocedure, 'execute'), 'anon cannot execute ' || f);
  end loop;
  foreach f in array array[
    'public.plan_attach_checkout(uuid, uuid, integer, text)', 'public.autopay_activate(uuid, text, text, text, text, text, integer, integer)',
    'public.autopay_begin_charge(uuid, date)', 'public.autopay_charge_result(uuid, text, text, text, text, text, date)',
    'public.plans_cron_work(uuid, date)', 'public.plan_mark_reminded(uuid, text)',
    'public.autopay_payment_method_event(text, text, boolean, text, text, integer, integer)'
  ] loop
    perform pp.ok(not has_function_privilege('authenticated', f::regprocedure, 'execute')
                  and has_function_privilege('service_role', f::regprocedure, 'execute'), 'service-role only: ' || f);
  end loop;
end $$;
