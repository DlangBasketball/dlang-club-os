-- ============================================================================
-- Finance suite (migration 20250420100400_finance_expenses.sql)
--
--   A. expense_categories / expense_suppliers: admin + finance of the org
--      read and write; coach and guardian see nothing; org B admin can neither
--      read, edit, delete nor create rows inside org A.
--   B. expenses: finance creates / edits / soft-deletes; hard delete is
--      refused for everyone; a soft-deleted expense is frozen; coach and
--      guardian see nothing; org B is denied every verb; cross-org foreign
--      keys are refused; changes land in audit_logs.
--   C. generate_recurring_expenses: idempotent monthly copies, org-scoped,
--      finance only.
--   D. coach_pay_rates: finance writes; the coach reads their own rate only;
--      org B and guardians are denied.
--   E. record_coach_payout / void_coach_payout: payout + expense in one go,
--      no double payment, coach sees their own payout, org B and guardians
--      are refused, void soft-deletes the expense.
--   F. expense-receipts bucket: private; admin + finance of the org only;
--      org B, coaches, guardians and anonymous callers are denied.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3 =
-- coach …011, guardian …f4). Org B …0002 (seed_tenants.sql); its admin is
-- created here. SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema fx;
grant usage on schema fx to authenticated, anon, service_role;

create function fx.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p (null = anon). Returns 'OK:<first column>' or 'ERR:<message>'.
create function fx.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
grant execute on all functions in schema fx to authenticated, anon, service_role;

-- Org B admin (synthetic) + one org B category.
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000e1', 'admin-b-fin@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id = 'b0000000-0000-0000-0000-0000000000e1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000e1', 'admin');
insert into public.expense_categories (id, org_id, name) values
  ('b0000000-0000-0000-0000-0000000000e9', '10000000-0000-0000-0000-000000000002', 'Synthetic B category');


-- ===========================================================================
-- A. Categories and suppliers
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$insert into public.expense_categories (id, org_id, name) values
          ('a0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'Hall rental') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'finance creates an expense category (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.expense_suppliers (id, org_id, name, contact) values
          ('a0000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001', 'Synthetic Sports Hall SA', 'office@example.test') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin creates a supplier (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$insert into public.expense_categories (org_id, name) values ('00000000-0000-0000-0000-000000000001', ' hall RENTAL ') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'duplicate category name (case / spaces) is refused');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.expense_categories$q$);
  perform fx.ok(v = 'OK:0', 'coach reads no expense categories (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.expense_suppliers$q$);
  perform fx.ok(v = 'OK:0', 'guardian reads no suppliers (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.expense_categories (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'Guardian cat') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'guardian cannot create a category');

  -- Cross-tenant denial (every verb).
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1',
       $q$select count(*)::text from public.expense_categories where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform fx.ok(v = 'OK:0', 'org B admin cannot read org A categories (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1',
       $q$select count(*)::text from public.expense_suppliers where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform fx.ok(v = 'OK:0', 'org B admin cannot read org A suppliers (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1',
       $q$with u as (update public.expense_categories set name = 'Taken' where id = 'a0000000-0000-0000-0000-0000000000e1' returning 1) select count(*)::text from u$q$);
  perform fx.ok(v = 'OK:0', 'org B admin cannot rename an org A category (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1',
       $q$with d as (delete from public.expense_suppliers where id = 'a0000000-0000-0000-0000-0000000000e2' returning 1) select count(*)::text from d$q$);
  perform fx.ok(v = 'OK:0', 'org B admin cannot delete an org A supplier (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1',
       $q$insert into public.expense_suppliers (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'Planted') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot create a supplier inside org A');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select count(*)::text from public.expense_categories where org_id = '10000000-0000-0000-0000-000000000002'$q$);
  perform fx.ok(v = 'OK:0', 'org A admin cannot read org B categories (' || v || ')');
end $$;

-- ===========================================================================
-- B. Expenses
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$insert into public.expenses (id, org_id, expense_date, amount, currency, category_id, supplier_id, coach_id, program_id,
                                       description, payment_method, status, paid_on)
          values ('a0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', current_date, 450.00, 'CHF',
                  'a0000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e2',
                  '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000043',
                  'Synthetic hall rental', 'bank_transfer', 'paid', current_date) returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'finance records an expense (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.expenses set amount = 480, status = 'unpaid', paid_on = null
                     where id = 'a0000000-0000-0000-0000-0000000000f1' returning 1) select count(*)::text from u$q$);
  perform fx.ok(v = 'OK:1', 'admin edits the expense (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$insert into public.expenses (org_id, expense_date, amount, currency) values
          ('00000000-0000-0000-0000-000000000001', current_date, 0, 'CHF') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'zero amount is refused');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$insert into public.expenses (org_id, expense_date, amount, currency, status, paid_on) values
          ('00000000-0000-0000-0000-000000000001', current_date, 10, 'CHF', 'unpaid', current_date) returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'paid_on on an unpaid expense is refused');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.expenses$q$);
  perform fx.ok(v = 'OK:0', 'coach reads no expenses (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.expenses$q$);
  perform fx.ok(v = 'OK:0', 'guardian reads no expenses (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.expenses (org_id, expense_date, amount, currency) values
          ('00000000-0000-0000-0000-000000000001', current_date, 10, 'CHF') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'coach cannot record an expense');

  -- Cross-tenant denial.
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1',
       $q$select count(*)::text from public.expenses where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform fx.ok(v = 'OK:0', 'org B admin cannot read org A expenses (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1',
       $q$with u as (update public.expenses set amount = 1 where id = 'a0000000-0000-0000-0000-0000000000f1' returning 1) select count(*)::text from u$q$);
  perform fx.ok(v = 'OK:0', 'org B admin cannot edit an org A expense (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1',
       $q$insert into public.expenses (org_id, expense_date, amount, currency) values
          ('00000000-0000-0000-0000-000000000001', current_date, 10, 'CHF') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot record an expense inside org A');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1',
       $q$insert into public.expenses (org_id, expense_date, amount, currency, category_id) values
          ('10000000-0000-0000-0000-000000000002', current_date, 10, 'USD', 'a0000000-0000-0000-0000-0000000000e1') returning id::text$q$);
  perform fx.ok(v like 'ERR:%CROSS_ORG%', 'org B expense cannot point at an org A category (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1',
       $q$insert into public.expenses (org_id, expense_date, amount, currency, coach_id) values
          ('10000000-0000-0000-0000-000000000002', current_date, 10, 'USD', '00000000-0000-0000-0000-000000000011') returning id::text$q$);
  perform fx.ok(v like 'ERR:%CROSS_ORG%', 'org B expense cannot point at an org A coach (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1',
       $q$insert into public.expenses (org_id, expense_date, amount, currency, category_id) values
          ('10000000-0000-0000-0000-000000000002', current_date, 25, 'USD', 'b0000000-0000-0000-0000-0000000000e9') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'org B admin records an expense in its own org (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select count(*)::text from public.expenses where org_id = '10000000-0000-0000-0000-000000000002'$q$);
  perform fx.ok(v = 'OK:0', 'org A admin cannot read org B expenses (' || v || ')');

  -- Delete = soft delete only.
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with d as (delete from public.expenses where id = 'a0000000-0000-0000-0000-0000000000f1' returning 1) select count(*)::text from d$q$);
  perform fx.ok(v = 'OK:0', 'hard delete is refused, even for admins (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$with u as (update public.expenses set deleted_at = now(), deleted_by = auth.uid(), delete_reason = 'Entered twice'
                     where id = 'a0000000-0000-0000-0000-0000000000f1' returning 1) select count(*)::text from u$q$);
  perform fx.ok(v = 'OK:1', 'finance soft-deletes the expense (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$with u as (update public.expenses set deleted_at = null, deleted_by = null, delete_reason = null
                     where id = 'a0000000-0000-0000-0000-0000000000f1' returning 1) select count(*)::text from u$q$);
  perform fx.ok(v = 'OK:0', 'a soft-deleted expense is frozen (' || v || ')');
  perform fx.ok((select count(*) >= 3 from public.audit_logs where target_table = 'expenses' and target_id = 'a0000000-0000-0000-0000-0000000000f1'),
                'expense insert / edit / soft delete are in audit_logs');
  perform fx.ok((select actor_id = '00000000-0000-0000-0000-0000000000f2' from public.audit_logs
                  where target_table = 'expenses' and target_id = 'a0000000-0000-0000-0000-0000000000f1'
                    and new_data->>'deleted_at' is not null order by id desc limit 1),
                'the soft delete is attributed to the finance user');
end $$;

-- ===========================================================================
-- C. Recurring monthly expenses
-- ===========================================================================
insert into public.expenses (id, org_id, expense_date, amount, currency, category_id, description, recurring_monthly)
values ('a0000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000001',
        (date_trunc('month', current_date) - interval '2 months')::date, 1200, 'CHF',
        'a0000000-0000-0000-0000-0000000000e1', 'Synthetic monthly hall', true);

do $$
declare v text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.generate_recurring_expenses(current_date)::text$q$);
  perform fx.ok(v = 'OK:2', 'two monthly copies are posted up to today (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.generate_recurring_expenses(current_date)::text$q$);
  perform fx.ok(v = 'OK:0', 'running it again posts nothing (idempotent) (' || v || ')');
  perform fx.ok((select bool_and(status = 'unpaid' and not recurring_monthly) from public.expenses
                  where recurrence_parent_id = 'a0000000-0000-0000-0000-0000000000f2'),
                'copies are unpaid and are not templates themselves');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.generate_recurring_expenses((current_date + 400))::text$q$);
  perform fx.ok(v = 'OK:0', 'no copies are posted in the future (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4', $q$select public.generate_recurring_expenses(current_date)::text$q$);
  perform fx.ok(v like 'ERR:%NOT_AUTHORIZED%', 'guardian cannot post recurring expenses (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1', $q$select public.generate_recurring_expenses(current_date)::text$q$);
  perform fx.ok(v = 'OK:0', 'org B admin posts nothing from org A templates (' || v || ')');
end $$;

-- ===========================================================================
-- D. Coach pay rates
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$insert into public.coach_pay_rates (org_id, coach_id, rate_type, amount, currency) values
          ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', 'per_session', 80, 'CHF') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'finance sets a coach rate (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.coach_pay_rates (org_id, coach_id, rate_type, amount, currency) values
          ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000012', 'hourly', 45, 'CHF') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin sets another coach rate (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.coach_pay_rates$q$);
  perform fx.ok(v = 'OK:1', 'a coach reads only their own rate (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$with u as (update public.coach_pay_rates set amount = 500 returning 1) select count(*)::text from u$q$);
  perform fx.ok(v = 'OK:0', 'a coach cannot change their rate (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.coach_pay_rates$q$);
  perform fx.ok(v = 'OK:0', 'guardian reads no rates (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1', $q$select count(*)::text from public.coach_pay_rates$q$);
  perform fx.ok(v = 'OK:0', 'org B admin cannot read org A rates (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1',
       $q$with d as (delete from public.coach_pay_rates returning 1) select count(*)::text from d$q$);
  perform fx.ok(v = 'OK:0', 'org B admin cannot delete org A rates (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1',
       $q$insert into public.coach_pay_rates (org_id, coach_id, rate_type, amount, currency) values
          ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000013', 'hourly', 1, 'CHF') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot set a rate inside org A');
end $$;

-- ===========================================================================
-- E. Coach payouts
-- ===========================================================================
do $$
declare v text; v_payout uuid; v_expense uuid;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$select public.record_coach_payout('00000000-0000-0000-0000-000000000011', date_trunc('month', current_date)::date,
            320, 'CHF', 'per_session', 80, 4, 0, 360, null, '{"sessions":4}'::jsonb, current_date, 'bank_transfer',
            'Coach pay', 'Synthetic payout')::text$q$);
  perform fx.ok(v like 'OK:%payout_id%', 'finance records a coach payout (' || v || ')');
  select id, expense_id into v_payout, v_expense from public.coach_payouts
   where coach_id = '00000000-0000-0000-0000-000000000011' and status = 'paid';
  perform fx.ok((select amount = 320 and status = 'paid' and coach_id = '00000000-0000-0000-0000-000000000011' and coach_payout_id = v_payout
                   from public.expenses where id = v_expense), 'the payout created a paid expense linked to it');
  perform fx.ok((select count(*) = 1 from public.expense_categories where org_id = '00000000-0000-0000-0000-000000000001' and name = 'Coach pay'),
                'the payout category was created once');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$select public.record_coach_payout('00000000-0000-0000-0000-000000000011', date_trunc('month', current_date)::date,
            320, 'CHF', 'per_session', 80, 4, 0, 360, null, null, current_date, 'bank_transfer', 'Coach pay', 'Again')::text$q$);
  perform fx.ok(v like 'ERR:%ALREADY_PAID%', 'the same month cannot be paid twice (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$select public.record_coach_payout('00000000-0000-0000-0000-000000000012', (date_trunc('month', current_date) + interval '1 month')::date,
            100, 'CHF', 'hourly', 45, 0, 0, 120, null, null, current_date, 'bank_transfer', 'Coach pay', 'Future')::text$q$);
  perform fx.ok(v like 'ERR:%FUTURE_MONTH%', 'a future month cannot be paid (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.coach_payouts$q$);
  perform fx.ok(v = 'OK:1', 'the coach sees their own payout (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.record_coach_payout('00000000-0000-0000-0000-000000000012', date_trunc('month', current_date)::date,
            100, 'CHF', 'hourly', 45, 0, 0, 120, null, null, current_date, 'bank_transfer', 'Coach pay', 'x')::text$q$);
  perform fx.ok(v like 'ERR:%NOT_AUTHORIZED%', 'guardian cannot record a payout (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1',
       $q$select public.record_coach_payout('00000000-0000-0000-0000-000000000012', date_trunc('month', current_date)::date,
            100, 'CHF', 'hourly', 45, 0, 0, 120, null, null, current_date, 'bank_transfer', 'Coach pay', 'x')::text$q$);
  perform fx.ok(v like 'ERR:%COACH_NOT_FOUND%', 'org B admin cannot pay an org A coach (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1', $q$select count(*)::text from public.coach_payouts$q$);
  perform fx.ok(v = 'OK:0', 'org B admin cannot read org A payouts (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1',
       format($q$select public.void_coach_payout(%L, 'nope')::text$q$, v_payout));
  perform fx.ok(v like 'ERR:%PAYOUT_NOT_FOUND%', 'org B admin cannot void an org A payout (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$with d as (delete from public.coach_payouts where id = %L returning 1) select count(*)::text from d$q$, v_payout));
  perform fx.ok(v = 'OK:0', 'payouts cannot be hard deleted (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.void_coach_payout(%L, 'Wrong month')::text$q$, v_payout));
  perform fx.ok(v like 'OK:%', 'finance voids the payout (' || v || ')');
  perform fx.ok((select deleted_at is not null and delete_reason = 'Wrong month' from public.expenses where id = v_expense),
                'voiding soft-deletes the linked expense');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$select public.record_coach_payout('00000000-0000-0000-0000-000000000011', date_trunc('month', current_date)::date,
            300, 'CHF', 'per_session', 75, 4, 0, 360, null, null, current_date, 'bank_transfer', 'Coach pay', 'Corrected')::text$q$);
  perform fx.ok(v like 'OK:%', 'after a void the month can be paid again (' || v || ')');
  perform fx.ok((select count(*) >= 2 from public.audit_logs where action in ('coach_payout.paid', 'coach_payout.void')),
                'payout actions are in audit_logs');
end $$;

-- ===========================================================================
-- F. expense-receipts bucket
-- ===========================================================================
insert into public.expenses (id, org_id, expense_date, amount, currency)
values ('a0000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-000000000001', current_date, 99, 'CHF');

do $$
declare
  v text;
  k  text := '00000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-0000000000f3/receipt.pdf';
  kd text := '00000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-0000000000f1/late.pdf';
begin
  perform fx.ok((select public = false from storage.buckets where id = 'expense-receipts'), 'expense-receipts bucket exists and is private');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       format($q$insert into storage.objects (bucket_id, name) values ('expense-receipts', %L) returning name$q$, k));
  perform fx.ok(v like 'OK:%', 'finance uploads a receipt (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       format($q$insert into storage.objects (bucket_id, name) values ('expense-receipts', %L) returning name$q$, kd));
  perform fx.ok(v like 'ERR:%', 'no upload to a soft-deleted expense');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$insert into storage.objects (bucket_id, name) values ('expense-receipts', 'not-a-key.pdf') returning name$q$);
  perform fx.ok(v like 'ERR:%', 'malformed receipt key is refused');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select count(*)::text from storage.objects where bucket_id = 'expense-receipts'$q$);
  perform fx.ok(v = 'OK:1', 'admin reads the receipt (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select count(*)::text from storage.objects where bucket_id = 'expense-receipts'$q$);
  perform fx.ok(v = 'OK:0', 'coach reads no receipts (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$insert into storage.objects (bucket_id, name) values ('expense-receipts', %L) returning name$q$,
              '00000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-0000000000f3/g.pdf'));
  perform fx.ok(v like 'ERR:%', 'guardian cannot upload a receipt');
  v := fx.run_as(null, $q$select count(*)::text from storage.objects where bucket_id = 'expense-receipts'$q$);
  perform fx.ok(v = 'OK:0' or v like 'ERR:%', 'anonymous caller reads no receipt (' || v || ')');

  -- Cross-tenant denial.
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1',
       $q$select count(*)::text from storage.objects where bucket_id = 'expense-receipts'$q$);
  perform fx.ok(v = 'OK:0', 'org B admin cannot read org A receipts (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1',
       format($q$insert into storage.objects (bucket_id, name) values ('expense-receipts', %L) returning name$q$,
              '00000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-0000000000f3/b.pdf'));
  perform fx.ok(v like 'ERR:%', 'org B admin cannot upload into org A');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1',
       format($q$with d as (delete from storage.objects where bucket_id = 'expense-receipts' and name = %L returning 1) select count(*)::text from d$q$, k));
  perform fx.ok(v = 'OK:0', 'org B admin cannot delete an org A receipt (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       format($q$update public.expenses set receipt_path = %L where id = 'a0000000-0000-0000-0000-0000000000f3' returning receipt_path$q$,
              '10000000-0000-0000-0000-000000000002/a0000000-0000-0000-0000-0000000000f3/x.pdf'));
  perform fx.ok(v like 'ERR:%', 'receipt_path must sit under the expense''s own org and id');
end $$;

-- Idempotency: the migration can be applied again.
\i supabase/migrations/20250420100400_finance_expenses.sql
select fx.ok(true, 'migration re-applies cleanly');
