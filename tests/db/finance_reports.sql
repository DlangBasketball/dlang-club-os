-- ============================================================================
-- Finance reports suite (migration 20250420103700_finance_reports.sql)
--
--   A. Club membership month report on synthetic members of a past season
--      (2024-25, so every payment date is in the past):
--        early      pays the whole season in August
--        late       nothing in Aug/Sep, pays Aug+Sep in October
--        partial    pays half of August
--        split      two payers (guardian 60 %, other 40 %), both pay August
--        zero       never pays; a credit note in December reduces the fee
--        sponsored  agreed fee 0, sponsored
--      + a carry-forward invoice (reported separately), a player on two
--      teams (one row, both names), team / status filters.
--   B. Reconciliation: report totals = sums of the underlying invoices
--      (amount due incl. credit notes), payments and instalment allocations.
--   C. Season overview = month report for every month.
--   D. accounting_transactions + accounting_last_exports.
--   E. Roles and cross-tenant denial.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3,
-- guardian …f4 of family …061 / athlete …071; family …062 = athletes …072,
-- …073). Org B …0002 (seed_tenants.sql). SYNTHETIC DATA ONLY.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema fr;
grant usage on schema fr to authenticated, anon, service_role;
create table fr.ctx (k text primary key, v text);
grant all on fr.ctx to authenticated, anon, service_role;

create function fr.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function fr.put(p_k text, p_v text) returns void language sql as $$
  insert into fr.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function fr.uid(p_k text) returns uuid language sql stable as $$ select v::uuid from fr.ctx where k = p_k $$;
create function fr.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
grant execute on all functions in schema fr to authenticated, anon, service_role;

-- Snapshot table filled by running the report as finance.
create table fr.rep (
  month date, membership_id uuid, athlete_id uuid, team_names text, payer_names text, currency text, agreed_fee numeric,
  due_in_month numeric, received_in_month numeric, applied_to_month numeric, open_for_month numeric, overdue_amount numeric,
  paid_to_date numeric, season_invoiced numeric, season_balance numeric, carry_forward_due numeric,
  carry_forward_received_in_month numeric, carry_forward_paid numeric, carry_forward_open numeric, report_status text);
grant all on fr.rep to authenticated, anon, service_role;

create function fr.snap(p_month date) returns text language plpgsql as $$
begin
  return fr.run_as('00000000-0000-0000-0000-0000000000f2', format($q$
    with ins as (
      insert into fr.rep select %L::date, r.membership_id, r.athlete_id, r.team_names, r.payer_names, r.currency, r.agreed_fee,
             r.due_in_month, r.received_in_month, r.applied_to_month, r.open_for_month, r.overdue_amount, r.paid_to_date,
             r.season_invoiced, r.season_balance, r.carry_forward_due, r.carry_forward_received_in_month, r.carry_forward_paid,
             r.carry_forward_open, r.report_status
        from public.club_membership_month_report(fr.uid('season'), %L::date) r returning 1)
    select count(*)::text from ins$q$, p_month, p_month));
end $$;
grant execute on function fr.snap(date) to authenticated, anon, service_role;

create function fr.get(p_month date, p_athlete uuid) returns fr.rep language sql stable as $$
  select * from fr.rep where month = p_month and athlete_id = p_athlete
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, status) values
  ('00000000-0000-0000-0000-000000000a74', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000061', 'Synthetic', 'Split', '2013-02-02', 'active'),
  ('00000000-0000-0000-0000-000000000a75', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000062', 'Synthetic', 'Zero', '2013-03-03', 'active'),
  ('00000000-0000-0000-0000-000000000a76', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000062', 'Synthetic', 'Sponsored', '2013-04-04', 'active');
insert into public.seasons (id, org_id, name, starts_on, ends_on, is_current) values
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000001', 'FR season 2023-24', '2023-08-01', '2024-07-31', false),
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000001', 'FR season 2024-25', '2024-08-01', '2025-07-31', false);
insert into public.teams (id, org_id, season_id, name, sport) values
  ('00000000-0000-0000-0000-000000000ac1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000a02', 'FR U14 National', 'basketball'),
  ('00000000-0000-0000-0000-000000000ac2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000a02', 'FR U16 Regional', 'basketball');
insert into public.team_memberships (org_id, team_id, athlete_id) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000ac1', '00000000-0000-0000-0000-000000000071'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000ac2', '00000000-0000-0000-0000-000000000071'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000ac1', '00000000-0000-0000-0000-000000000072');
select fr.put('season', '00000000-0000-0000-0000-000000000a02');

-- Org B: an admin (cross-tenant probes) and one export run of its own.
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000005f1', 'fr-admin-b@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000005f1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000005f1', 'admin');

-- Memberships (admin issues; one invoice + 11-instalment plan per payer).
do $$
declare
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  v text;
  base text := '"season_id":"00000000-0000-0000-0000-000000000a02","first_due_month":"2024-08-01","due_day":28';
  k int := 0;
  r record;
begin
  for r in select * from (values
      ('early',   '00000000-0000-0000-0000-000000000071', 1100, 11, '[{"kind":"family","share_kind":"fixed","share_value":1100}]', false),
      ('late',    '00000000-0000-0000-0000-000000000072', 1100, 11, '[{"kind":"family","share_kind":"fixed","share_value":1100}]', false),
      ('partial', '00000000-0000-0000-0000-000000000073', 1100, 11, '[{"kind":"family","share_kind":"fixed","share_value":1100}]', false),
      ('split',   '00000000-0000-0000-0000-000000000a74', 1000, 10, '[{"kind":"guardian","profile_id":"00000000-0000-0000-0000-0000000000f4","share_kind":"percent","share_value":60},{"kind":"other","name":"FR Synthetic Uncle","share_kind":"percent","share_value":40}]', false),
      ('zero',    '00000000-0000-0000-0000-000000000a75', 1100, 11, '[{"kind":"family","share_kind":"fixed","share_value":1100}]', false),
      ('sponsored','00000000-0000-0000-0000-000000000a76', 0, 11, '[]', true)) as x(tag, athlete, fee, cnt, payers, sponsored)
  loop
    k := k + 1;
    v := fr.run_as(admin_a, format($q$select public.membership_issue(%L::jsonb)::text$q$,
      format('{"request_id":"00000000-0000-0000-0000-000000000b%s","athlete_id":"%s","agreed_fee":%s,"installment_count":%s,"payers":%s,"sponsored":%s,%s}',
             lpad(k::text, 2, '0'), r.athlete, r.fee, r.cnt, r.payers, case when r.sponsored then 'true' else 'false' end, base)));
    perform fr.ok(v like 'OK:%', 'membership issued: ' || r.tag || ' ' || left(v, 120));
    perform fr.put(r.tag, (substr(v, 4)::jsonb)->>'membership_id');
    perform fr.put(r.tag || '_inv', (substr(v, 4)::jsonb)->'invoices'->0->>'invoice_id');
    if r.tag = 'split' then perform fr.put('split_inv2', (substr(v, 4)::jsonb)->'invoices'->1->>'invoice_id'); end if;
  end loop;

  -- Carry-forward from 2023-24 to 2024-25 for the early payer (separate invoice).
  v := fr.run_as(admin_a, $q$select public.membership_issue('{"request_id":"00000000-0000-0000-0000-000000000b20","athlete_id":"00000000-0000-0000-0000-000000000071","season_id":"00000000-0000-0000-0000-000000000a01","agreed_fee":0,"payers":[],"first_due_month":"2023-08-01"}'::jsonb)->>'membership_id'$q$);
  perform fr.ok(v like 'OK:%', 'previous season membership for the carry-forward');
  v := fr.run_as(admin_a, format($q$select public.membership_carry_forward(%L, %L, 150, 'FR synthetic carry-forward')->>'invoice_id'$q$,
                                 substr(v, 4), fr.uid('early')));
  perform fr.ok(v like 'OK:%', 'carry-forward invoice issued');
  perform fr.put('cf_inv', substr(v, 4));
end $$;

-- Payments (finance, dated in the past) and a dated credit note.
do $$
declare finance_a uuid := '00000000-0000-0000-0000-0000000000f2'; v text;
begin
  v := fr.run_as(finance_a, format($q$select public.record_offline_payment(%L, 1100, 'bank_transfer', '2024-08-05')->>'status'$q$, fr.uid('early_inv')));
  perform fr.ok(v like 'OK:%', 'early payer pays the season in August ' || v);
  v := fr.run_as(finance_a, format($q$select public.record_offline_payment(%L, 200, 'bank_transfer', '2024-10-10')->>'status'$q$, fr.uid('late_inv')));
  perform fr.ok(v like 'OK:%', 'late payer pays Aug + Sep in October');
  v := fr.run_as(finance_a, format($q$select public.record_offline_payment(%L, 50, 'twint', '2024-08-20')->>'status'$q$, fr.uid('partial_inv')));
  perform fr.ok(v like 'OK:%', 'partial payer pays half of August');
  v := fr.run_as(finance_a, format($q$select public.record_offline_payment(%L, 60, 'bank_transfer', '2024-08-15')->>'status'$q$, fr.uid('split_inv')));
  perform fr.ok(v like 'OK:%', 'split payer 1 pays August');
  v := fr.run_as(finance_a, format($q$select public.record_offline_payment(%L, 40, 'bank_transfer', '2024-08-30')->>'status'$q$, fr.uid('split_inv2')));
  perform fr.ok(v like 'OK:%', 'split payer 2 pays August');
  v := fr.run_as(finance_a, format($q$select public.record_offline_payment(%L, 150, 'manual', '2024-09-10')->>'status'$q$, fr.uid('cf_inv')));
  perform fr.ok(v like 'OK:%', 'carry-forward paid in September');
end $$;

-- Credit note of 100 on the zero payer, dated 2024-12-15 (as a historic document).
insert into public.invoice_adjustments (org_id, invoice_id, number, kind, amount, currency, reason, created_at)
select '00000000-0000-0000-0000-000000000001', fr.uid('zero_inv'), 'FR-CN-1', 'credit_note', 100, 'CHF', 'FR synthetic goodwill', '2024-12-15 10:00+01';
select public.refresh_invoice_adjustments(fr.uid('zero_inv'));

-- Snapshots of every month of the season.
do $$
declare m date := '2024-08-01'; v text;
begin
  while m <= '2025-07-01' loop
    v := fr.snap(m);
    if v not like 'OK:%' then perform fr.ok(false, 'report for ' || m || ': ' || v); end if;
    m := (m + interval '1 month')::date;
  end loop;
  perform fr.ok((select count(*) from fr.rep) = 12 * 6, 'every month lists every membership of the season (6 members x 12 months)');
end $$;

-- ===========================================================================
-- A. Per-member rules
-- ===========================================================================
do $$
declare r fr.rep;
begin
  r := fr.get('2024-08-01', '00000000-0000-0000-0000-000000000071');
  perform fr.ok(r.due_in_month = 100 and r.received_in_month = 1100 and r.applied_to_month = 100 and r.open_for_month = 0
                and r.report_status = 'paid' and r.season_balance = 0 and r.paid_to_date = 1100,
                'early payer, August: due 100, received 1100, applied 100, paid, nothing left for the season');
  r := fr.get('2024-09-01', '00000000-0000-0000-0000-000000000071');
  perform fr.ok(r.due_in_month = 100 and r.received_in_month = 0 and r.applied_to_month = 100 and r.report_status = 'paid',
                'early payer, September: paid up front (no cash this month, charge covered)');
  perform fr.ok(r.carry_forward_due = 150 and r.carry_forward_received_in_month = 150 and r.carry_forward_open = 0
                and r.season_invoiced = 1100,
                'carry-forward shown separately (150 received in September), never in the season fee');
  perform fr.ok(r.team_names like '%FR U14 National%' and r.team_names like '%FR U16 Regional%',
                'player on two teams: one row with both team names');
  r := fr.get('2025-07-01', '00000000-0000-0000-0000-000000000071');
  perform fr.ok(r.due_in_month = 0 and r.report_status = 'no_installment', 'July: no instalment this month');

  r := fr.get('2024-08-01', '00000000-0000-0000-0000-000000000072');
  perform fr.ok(r.due_in_month = 100 and r.applied_to_month = 0 and r.report_status = 'unpaid' and r.overdue_amount = 100,
                'late payer, August: unpaid, 100 overdue at month end');
  r := fr.get('2024-09-01', '00000000-0000-0000-0000-000000000072');
  perform fr.ok(r.report_status = 'overdue' and r.overdue_amount = 200, 'late payer, September: arrears from August -> overdue, 200 overdue');
  r := fr.get('2024-10-01', '00000000-0000-0000-0000-000000000072');
  perform fr.ok(r.received_in_month = 200 and r.applied_to_month = 0 and r.open_for_month = 100 and r.report_status = 'unpaid'
                and r.overdue_amount = 100 and r.season_balance = 900,
                'late payer, October: 200 received settles Aug + Sep (FIFO), October still open');

  r := fr.get('2024-08-01', '00000000-0000-0000-0000-000000000073');
  perform fr.ok(r.applied_to_month = 50 and r.open_for_month = 50 and r.report_status = 'partially_paid', 'partial payer, August: partially paid');
  r := fr.get('2024-09-01', '00000000-0000-0000-0000-000000000073');
  perform fr.ok(r.report_status = 'overdue' and r.overdue_amount = 150 and r.received_in_month = 0, 'partial payer, September: overdue 150');

  r := fr.get('2024-08-01', '00000000-0000-0000-0000-000000000a74');
  perform fr.ok(r.due_in_month = 100 and r.received_in_month = 100 and r.applied_to_month = 100 and r.report_status = 'paid'
                and r.payer_names like '%FR Synthetic Uncle%' and r.payer_names like '%,%',
                'split payer: both shares due and paid in August, both payers named');
  r := fr.get('2025-06-01', '00000000-0000-0000-0000-000000000a74');
  perform fr.ok(r.due_in_month = 0 and r.report_status = 'overdue', 'split payer, June: no instalment (10 instalments) but arrears -> overdue');

  r := fr.get('2024-11-01', '00000000-0000-0000-0000-000000000a75');
  perform fr.ok(r.season_invoiced = 1100 and r.received_in_month = 0 and r.paid_to_date = 0 and r.report_status = 'overdue',
                'zero payer before the credit note: 1100 invoiced, nothing received');
  r := fr.get('2025-06-01', '00000000-0000-0000-0000-000000000a75');
  perform fr.ok(r.season_invoiced = 1000 and r.due_in_month = 0 and r.season_balance = 1000,
                'credit note of 100 (December) comes off the last instalment (June due 0); season fee 1000');
  r := fr.get('2024-08-01', '00000000-0000-0000-0000-000000000a76');
  perform fr.ok(r.report_status = 'sponsored' and r.agreed_fee = 0, 'sponsored member listed with status sponsored');
end $$;

-- Filters.
do $$
declare v text;
begin
  v := fr.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select string_agg(athlete_id::text, ',') from public.club_membership_month_report(%L, '2024-08-01', '00000000-0000-0000-0000-000000000ac2')$q$, fr.uid('season')));
  perform fr.ok(v = 'OK:00000000-0000-0000-0000-000000000071', 'team filter: only the U16 player');
  v := fr.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select count(*)::text from public.club_membership_month_report(%L, '2024-08-01', '00000000-0000-0000-0000-000000000ac1')$q$, fr.uid('season')));
  perform fr.ok(v = 'OK:2', 'team filter: U14 has two players');
  v := fr.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select count(*)::text from public.club_membership_month_report(%L, '2024-08-01', null, 'unpaid')$q$, fr.uid('season')));
  perform fr.ok(v = 'OK:2', 'status filter: two unpaid in August (late, zero)');
  v := fr.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select count(*)::text from public.club_membership_month_report(%L, '2024-08-01', null, 'bogus')$q$, fr.uid('season')));
  perform fr.ok(v like 'ERR:INVALID_STATUS%', 'unknown status refused');
  v := fr.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select count(*)::text from public.club_membership_month_report(%L, '2025-08-01')$q$, fr.uid('season')));
  perform fr.ok(v like 'ERR:MONTH_OUTSIDE_SEASON%', 'month outside the season refused');
end $$;

-- ===========================================================================
-- B. Reconciliation against the underlying records
-- ===========================================================================
do $$
declare v_inv_due numeric; v_pay numeric; v_paid numeric; v_bal numeric; v_alloc numeric; m date; v_sched numeric;
begin
  select sum(i.total_chf + i.adjustments_total) into v_inv_due
    from public.invoices i join public.memberships ms on ms.id = i.membership_id
   where ms.season_id = fr.uid('season') and i.charge_kind = 'season_fee' and i.status::text not in ('draft', 'cancelled', 'void');
  perform fr.ok((select sum(due_in_month) from fr.rep) = v_inv_due and v_inv_due = 5300,
                'sum of monthly amounts due over the season = sum of season-fee invoice amounts due incl. credit notes (5300)');

  select sum(p.amount_chf) into v_pay
    from public.payments p join public.invoices i on i.id = p.invoice_id join public.memberships ms on ms.id = i.membership_id
   where ms.season_id = fr.uid('season') and i.charge_kind = 'season_fee'
     and (p.status = 'succeeded' or (p.status in ('refunded', 'partially_refunded') and p.amount_chf < 0));
  perform fr.ok((select sum(received_in_month) from fr.rep) = v_pay and v_pay = 1450,
                'sum of cash received per month = sum of payments on season-fee invoices (1450)');
  perform fr.ok((select sum(carry_forward_received_in_month) from fr.rep) = 150, 'carry-forward cash reconciles separately (150)');

  select sum(public.invoice_net_paid(i.id)), sum(greatest(i.total_chf + i.adjustments_total - public.invoice_net_paid(i.id), 0)) into v_paid, v_bal
    from public.invoices i join public.memberships ms on ms.id = i.membership_id
   where ms.season_id = fr.uid('season') and i.charge_kind = 'season_fee' and i.status::text not in ('draft', 'cancelled', 'void');
  perform fr.ok((select sum(paid_to_date) from fr.rep where month = '2025-07-01') = v_paid
                and (select sum(season_balance) from fr.rep where month = '2025-07-01') = v_bal,
                'July: paid to date and remaining balance = invoice_net_paid / open balance of the invoices');
  perform fr.ok(not exists (select 1 from fr.rep where paid_to_date + season_balance <> season_invoiced),
                'every row: paid to date + remaining balance = season fee invoiced (no overpayments)');

  -- Allocation agrees with the stored instalment allocation (refresh_installment_status).
  select sum(x.amount_paid) into v_alloc
    from public.payment_plan_installments x join public.payment_plans pl on pl.id = x.plan_id
    join public.invoices i on i.id = pl.invoice_id join public.memberships ms on ms.id = i.membership_id
   where ms.season_id = fr.uid('season');
  perform fr.ok(v_alloc = (select sum(paid_to_date) from fr.rep where month = '2025-07-01') and v_alloc = 1450,
                'instalment allocation: stored amount_paid (refresh_installment_status) = FIFO-allocated cash at season end');

  -- Each month: due = scheduled instalments in the month (before the credit note month adjustments).
  m := '2024-08-01';
  select sum(x.amount) into v_sched
    from public.payment_plan_installments x join public.payment_plans pl on pl.id = x.plan_id
    join public.invoices i on i.id = pl.invoice_id join public.memberships ms on ms.id = i.membership_id
   where ms.season_id = fr.uid('season') and x.due_date between m and (m + interval '1 month - 1 day')::date;
  perform fr.ok((select sum(due_in_month) from fr.rep where month = m) = v_sched and v_sched = 500,
                'August: due = sum of scheduled instalments with a due date in August (500)');
end $$;

-- ===========================================================================
-- C. Season overview = month report
-- ===========================================================================
do $$
declare v text;
begin
  v := fr.run_as('00000000-0000-0000-0000-0000000000f2', format($q$
    select (count(*) = 72 and bool_and(o.due_in_month = r.due_in_month and o.received_in_month = r.received_in_month
                                       and o.applied_to_month = r.applied_to_month and o.report_status = r.report_status
                                       and o.paid_to_date = r.paid_to_date and o.season_balance = r.season_balance))::text
      from public.club_membership_season_overview(%L) o
      join fr.rep r on r.membership_id = o.membership_id and r.month = o.month$q$, fr.uid('season')));
  perform fr.ok(v = 'OK:true', 'season overview: 12 months x 6 members, same numbers as the month report ' || v);
end $$;

-- ===========================================================================
-- D. Accounting transactions + last exports
-- ===========================================================================
do $$
declare v text;
begin
  v := fr.run_as('00000000-0000-0000-0000-0000000000f2', $q$
    select (count(*) filter (where kind = 'payment') = 6 and count(*) filter (where kind = 'credit_note') = 1
            and bool_and(invoice_number is not null and category is not null))::text
      from public.accounting_transactions('2024-08-01', '2024-12-31', null, 'club_membership')$q$);
  perform fr.ok(v = 'OK:true', 'accounting transactions: payments and credit note of the period with invoice number + category ' || v);
  v := fr.run_as('00000000-0000-0000-0000-0000000000f2', $q$
    select (sum(amount) filter (where kind = 'credit_note'))::text from public.accounting_transactions('2024-12-01', '2024-12-31')$q$);
  perform fr.ok(v = 'OK:-100.00', 'credit note exported with a negative amount ' || v);
  v := fr.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.accounting_transactions('2024-08-01', '2024-12-31', null, 'shop')$q$);
  perform fr.ok(v = 'OK:0', 'category filter: no shop transactions');
  v := fr.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.accounting_transactions('2024-12-31', '2024-08-01')$q$);
  perform fr.ok(v like 'ERR:INVALID_DATE%', 'reversed period refused');

  insert into public.audit_logs (org_id, actor_id, action, target_table, new_data, created_at) values
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f2', 'accounting.export.transactions_csv', 'invoices', '{"rows":3}', now() - interval '2 days'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f2', 'accounting.export_failed.transactions_csv', 'invoices', '{"error":"x"}', now() - interval '1 day'),
    ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000005f1', 'accounting.export.journal', 'invoices', '{}', now());
  v := fr.run_as('00000000-0000-0000-0000-0000000000f2', $q$select string_agg(kind || ':' || ok, ',') from public.accounting_last_exports()$q$);
  perform fr.ok(v = 'OK:transactions_csv:false', 'last export per kind: latest run (failed) of org A only ' || v);
end $$;

-- ===========================================================================
-- E. Roles and cross-tenant denial
-- ===========================================================================
do $$
declare v text;
begin
  v := fr.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select count(*)::text from public.club_membership_month_report(%L, '2024-08-01')$q$, fr.uid('season')));
  perform fr.ok(v = 'OK:6', 'admin reads the report');
  v := fr.run_as('00000000-0000-0000-0000-0000000000f3', format($q$select count(*)::text from public.club_membership_month_report(%L, '2024-08-01')$q$, fr.uid('season')));
  perform fr.ok(v like 'ERR:NOT_AUTHORIZED%', 'coach refused');
  v := fr.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select count(*)::text from public.club_membership_month_report(%L, '2024-08-01')$q$, fr.uid('season')));
  perform fr.ok(v like 'ERR:NOT_AUTHORIZED%', 'guardian refused');
  v := fr.run_as(null, format($q$select count(*)::text from public.club_membership_month_report(%L, '2024-08-01')$q$, fr.uid('season')));
  perform fr.ok(v like 'ERR:%', 'anonymous refused');
  v := fr.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select count(*)::text from public.club_membership_report_internal('00000000-0000-0000-0000-000000000001', %L, '2024-08-01')$q$, fr.uid('season')));
  perform fr.ok(v like 'ERR:%permission denied%', 'internal function not callable by clients');

  -- Org B finance / admin: org A's season does not exist for them.
  v := fr.run_as('b0000000-0000-0000-0000-0000000005f1', format($q$select count(*)::text from public.club_membership_month_report(%L, '2024-08-01')$q$, fr.uid('season')));
  perform fr.ok(v like 'ERR:SEASON_NOT_FOUND%', 'cross-tenant: org B admin cannot read org A''s season report');
  v := fr.run_as('b0000000-0000-0000-0000-0000000005f1', format($q$select count(*)::text from public.club_membership_season_overview(%L)$q$, fr.uid('season')));
  perform fr.ok(v like 'ERR:SEASON_NOT_FOUND%', 'cross-tenant: org B admin cannot read org A''s season overview');
  v := fr.run_as('b0000000-0000-0000-0000-0000000005f1', $q$select count(*)::text from public.accounting_transactions('2024-01-01', '2026-12-31')
                                                            where invoice_number like 'FR%' or category = 'club_membership'$q$);
  perform fr.ok(v = 'OK:0', 'cross-tenant: org B accounting transactions contain nothing of org A');
  v := fr.run_as('b0000000-0000-0000-0000-0000000005f1', $q$select string_agg(kind, ',') from public.accounting_last_exports()$q$);
  perform fr.ok(v = 'OK:journal', 'cross-tenant: org B sees only its own export runs');
  v := fr.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.accounting_transactions('2024-01-01', '2024-12-31')$q$);
  perform fr.ok(v like 'ERR:NOT_AUTHORIZED%', 'coach cannot export accounting transactions');
  v := fr.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.accounting_last_exports()$q$);
  perform fr.ok(v like 'ERR:NOT_AUTHORIZED%', 'guardian cannot read export runs');
end $$;
