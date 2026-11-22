-- ============================================================================
-- Finance reports (additive, idempotent): read-only functions, no new tables.
--
--   1. club_membership_month_report(season, month, team?, status?)
--      One row per season-fee membership of a club season for one month:
--      due that month, cash received that month, applied to that month's
--      charges, open, overdue, season balance, carry-forward, status.
--      The screen AND the Excel workbook read this function, so both show the
--      same numbers. club_membership_season_overview(season, team?) runs the
--      same computation for every month of the season (Season Overview sheet).
--   2. accounting_transactions(from, to, entity?, category?)
--      Invoices, adjustment documents (credit / debit notes, write-offs,
--      cancellations) and payments / refunds / reversals of a period with the
--      original invoice number, payment reference, category, issuing entity
--      and source label (accountant export).
--   3. accounting_last_exports()
--      Last accounting export per kind from audit_logs (the table every export
--      already writes); finance can read it without reading audit_logs.
--
-- Every function is SECURITY DEFINER, sets search_path, checks the caller is
-- admin or finance of the club and takes the org from the session
-- (current_org_id()), never from an argument.
--
-- Calculation rules of the membership report (docs/finance-reports.md):
--   * Members: memberships kind 'season_fee' of the season, status <> cancelled.
--   * Season-fee charges: invoices with membership_id = the membership and
--     charge_kind 'season_fee', not draft / cancelled / void. Each invoice with
--     an instalment plan (kind 'installments', status active/paused/completed)
--     contributes its instalments (not cancelled / skipped) by seq; an invoice
--     without a plan is one charge due on its due date (issue date if none).
--   * Credit / debit notes (invoice_adjustments, created before the cut-off and
--     not voided by then) change the invoice's amount due; a reduction comes
--     off the LATEST instalments first, an increase goes on the last one, so the
--     effective charges always add up to the invoice's amount due.
--   * Payments count as public.invoice_net_paid() does (succeeded rows incl.
--     reversals, plus negative refund rows), by paid_at, up to the cut-off
--     (end of the month in the club's time zone).
--   * Allocation: cumulative net paid of an invoice settles its charges FIFO by
--     instalment seq — the rule refresh_installment_status() uses for
--     payment_plan_installments.amount_paid — evaluated as of the cut-off.
--   * Overdue: open charges due before the reference day (day after month end,
--     or today for the current month). Status 'overdue' = an open charge due
--     before the selected month (arrears); otherwise the month's own status.
--   * Carry-forward invoices (charge_kind 'carry_forward') are reported in
--     separate columns, never in the season fee.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Club membership month report
-- ---------------------------------------------------------------------------
create or replace function public.club_membership_report_internal(
  p_org uuid, p_season uuid, p_month date, p_team uuid default null)
returns table (
  membership_id uuid, athlete_id uuid, athlete_name text, family_id uuid, family_name text,
  team_names text, payer_names text, invoice_numbers text, currency text, agreed_fee numeric, sponsored boolean,
  due_in_month numeric, received_in_month numeric, applied_to_month numeric, open_for_month numeric,
  overdue_amount numeric, arrears_before_month numeric, paid_to_date numeric, season_invoiced numeric, season_balance numeric,
  carry_forward_due numeric, carry_forward_received_in_month numeric, carry_forward_paid numeric, carry_forward_open numeric,
  report_status text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tz      text := coalesce(public.training_org_tz(p_org), 'Europe/Zurich');
  v_m_start date := date_trunc('month', p_month)::date;
  v_m_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_today   date := (now() at time zone coalesce(public.training_org_tz(p_org), 'Europe/Zurich'))::date;
  v_from_ts timestamptz;
  v_cut_ts  timestamptz;
  v_ref     date;
begin
  v_from_ts := (v_m_start::timestamp) at time zone v_tz;
  v_cut_ts  := ((v_m_end + 1)::timestamp) at time zone v_tz;
  v_ref     := least(v_m_end + 1, v_today);

  return query
  with mem as (
    select m.id, m.athlete_id, m.family_id, m.currency, m.agreed_fee, m.sponsored
      from public.memberships m
     where m.org_id = p_org and m.season_id = p_season and m.kind = 'season_fee' and m.status <> 'cancelled'
  ),
  team_of as (
    select tm.athlete_id, t.id as team_id, t.name
      from public.team_memberships tm
      join public.teams t on t.id = tm.team_id and t.org_id = p_org
     where tm.org_id = p_org
       and tm.status <> 'inactive'
       and (t.season_id = p_season or t.season_id is null)
       and tm.athlete_id in (select mem.athlete_id from mem)
  ),
  mem_f as (
    select mem.* from mem
     where p_team is null or exists (select 1 from team_of x where x.athlete_id = mem.athlete_id and x.team_id = p_team)
  ),
  inv as (
    select i.id, i.membership_id, i.charge_kind, i.number, i.total_chf, i.due_date, i.issued_at,
           coalesce((select sum(case when a.kind = 'debit_note' then a.amount else -a.amount end)
                       from public.invoice_adjustments a
                      where a.invoice_id = i.id and a.created_at < v_cut_ts
                        and (a.voided_at is null or a.voided_at >= v_cut_ts)), 0) as adj,
           greatest(coalesce((select sum(p.amount_chf) from public.payments p
                               where p.invoice_id = i.id
                                 and (p.status = 'succeeded' or (p.status in ('refunded', 'partially_refunded') and p.amount_chf < 0))
                                 and coalesce(p.paid_at, p.created_at) < v_cut_ts), 0), 0) as paid_asof,
           coalesce((select sum(p.amount_chf) from public.payments p
                      where p.invoice_id = i.id
                        and (p.status = 'succeeded' or (p.status in ('refunded', 'partially_refunded') and p.amount_chf < 0))
                        and coalesce(p.paid_at, p.created_at) >= v_from_ts
                        and coalesce(p.paid_at, p.created_at) < v_cut_ts), 0) as rcv_month
      from public.invoices i
     where i.org_id = p_org
       and i.membership_id in (select mem_f.id from mem_f)
       and i.charge_kind in ('season_fee', 'carry_forward')
       and i.status::text not in ('draft', 'cancelled', 'void')
  ),
  raw_charges as (
    select inv.id as invoice_id, x.seq, x.due_date, x.amount::numeric as amount
      from inv
      join public.payment_plans pl on pl.invoice_id = inv.id and pl.kind = 'installments'
                                   and pl.status in ('active', 'paused', 'completed')
      join public.payment_plan_installments x on x.plan_id = pl.id and x.status not in ('cancelled', 'skipped')
     where inv.charge_kind = 'season_fee'
    union all
    select inv.id, 1, coalesce(inv.due_date, (inv.issued_at at time zone v_tz)::date), inv.total_chf
      from inv
     where inv.charge_kind = 'season_fee'
       and not exists (select 1 from public.payment_plans pl where pl.invoice_id = inv.id and pl.kind = 'installments'
                                                              and pl.status in ('active', 'paused', 'completed'))
  ),
  sized as (
    select c.*, inv.total_chf + inv.adj as inv_due, inv.paid_asof,
           sum(c.amount) over (partition by c.invoice_id) as base_total,
           coalesce(sum(c.amount) over (partition by c.invoice_id order by c.seq desc
                                         rows between unbounded preceding and 1 preceding), 0) as later_sum,
           max(c.seq) over (partition by c.invoice_id) as last_seq
      from raw_charges c join inv on inv.id = c.invoice_id
  ),
  eff as (
    select s.invoice_id, s.seq, s.due_date, s.paid_asof,
           case
             when s.inv_due - s.base_total < 0
               then s.amount - least(s.amount, greatest((s.base_total - greatest(s.inv_due, 0)) - s.later_sum, 0))
             when s.seq = s.last_seq then s.amount + (s.inv_due - s.base_total)
             else s.amount
           end as amount
      from sized s
  ),
  alloc as (
    select e.*,
           least(e.amount, greatest(e.paid_asof - (sum(e.amount) over (partition by e.invoice_id order by e.seq) - e.amount), 0)) as applied
      from eff e
  ),
  per_mem as (
    select inv.membership_id,
           coalesce(sum(a.amount) filter (where a.due_date between v_m_start and v_m_end), 0) as due_m,
           coalesce(sum(a.applied) filter (where a.due_date between v_m_start and v_m_end), 0) as applied_m,
           coalesce(sum(a.amount - a.applied) filter (where a.due_date < v_ref), 0) as overdue,
           coalesce(sum(a.amount - a.applied) filter (where a.due_date < v_m_start), 0) as arrears
      from alloc a join inv on inv.id = a.invoice_id
     group by inv.membership_id
  ),
  per_inv as (
    select inv.membership_id,
           coalesce(sum(inv.rcv_month) filter (where inv.charge_kind = 'season_fee'), 0) as rcv_m,
           coalesce(sum(inv.paid_asof) filter (where inv.charge_kind = 'season_fee'), 0) as paid,
           coalesce(sum(inv.total_chf + inv.adj) filter (where inv.charge_kind = 'season_fee'), 0) as invoiced,
           coalesce(sum(greatest(inv.total_chf + inv.adj - inv.paid_asof, 0)) filter (where inv.charge_kind = 'season_fee'), 0) as balance,
           coalesce(sum(inv.total_chf + inv.adj) filter (where inv.charge_kind = 'carry_forward'), 0) as cf_due,
           coalesce(sum(inv.rcv_month) filter (where inv.charge_kind = 'carry_forward'), 0) as cf_rcv_m,
           coalesce(sum(inv.paid_asof) filter (where inv.charge_kind = 'carry_forward'), 0) as cf_paid,
           coalesce(sum(greatest(inv.total_chf + inv.adj - inv.paid_asof, 0)) filter (where inv.charge_kind = 'carry_forward'), 0) as cf_open,
           string_agg(inv.number, ', ' order by inv.charge_kind desc, inv.number) as numbers
      from inv
     group by inv.membership_id
  )
  select m.id, m.athlete_id,
         btrim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')),
         m.family_id, f.name,
         (select string_agg(distinct x.name, ', ') from team_of x where x.athlete_id = m.athlete_id),
         coalesce((select string_agg(mp.payer_name, ', ' order by mp.sort) from public.membership_payers mp
                    where mp.membership_id = m.id and mp.payer_name is not null), f.name),
         pi.numbers,
         m.currency, m.agreed_fee, m.sponsored,
         coalesce(pm.due_m, 0), coalesce(pi.rcv_m, 0), coalesce(pm.applied_m, 0), coalesce(pm.due_m - pm.applied_m, 0),
         coalesce(pm.overdue, 0), coalesce(pm.arrears, 0), coalesce(pi.paid, 0), coalesce(pi.invoiced, 0), coalesce(pi.balance, 0),
         coalesce(pi.cf_due, 0), coalesce(pi.cf_rcv_m, 0), coalesce(pi.cf_paid, 0), coalesce(pi.cf_open, 0),
         case
           when m.sponsored then 'sponsored'
           when coalesce(pm.arrears, 0) > 0 then 'overdue'
           when coalesce(pm.due_m, 0) <= 0 then 'no_installment'
           when pm.due_m - pm.applied_m <= 0 then 'paid'
           when pm.applied_m > 0 then 'partially_paid'
           else 'unpaid'
         end
    from mem_f m
    join public.athletes a on a.id = m.athlete_id
    left join public.families f on f.id = m.family_id
    left join per_mem pm on pm.membership_id = m.id
    left join per_inv pi on pi.membership_id = m.id
   order by a.last_name, a.first_name, m.id;
end;
$$;

create or replace function public.club_membership_report_check(p_season uuid, p_month date)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id(); se public.seasons;
begin
  if v_org is null or not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into se from public.seasons where id = p_season and org_id = v_org;
  if not found then raise exception 'SEASON_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_month is not null and (date_trunc('month', p_month)::date < date_trunc('month', se.starts_on)::date or p_month > se.ends_on) then
    raise exception 'MONTH_OUTSIDE_SEASON' using errcode = 'P0001';
  end if;
  return v_org;
end;
$$;

create or replace function public.club_membership_month_report(
  p_season uuid, p_month date, p_team uuid default null, p_status text default null)
returns table (
  membership_id uuid, athlete_id uuid, athlete_name text, family_id uuid, family_name text,
  team_names text, payer_names text, invoice_numbers text, currency text, agreed_fee numeric, sponsored boolean,
  due_in_month numeric, received_in_month numeric, applied_to_month numeric, open_for_month numeric,
  overdue_amount numeric, arrears_before_month numeric, paid_to_date numeric, season_invoiced numeric, season_balance numeric,
  carry_forward_due numeric, carry_forward_received_in_month numeric, carry_forward_paid numeric, carry_forward_open numeric,
  report_status text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare v_org uuid;
begin
  if p_month is null then raise exception 'MONTH_REQUIRED' using errcode = 'P0001'; end if;
  if p_status is not null and p_status not in ('paid', 'partially_paid', 'unpaid', 'no_installment', 'overdue', 'sponsored') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  v_org := public.club_membership_report_check(p_season, p_month);
  if p_team is not null and not exists (select 1 from public.teams t where t.id = p_team and t.org_id = v_org) then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  return query
    select r.* from public.club_membership_report_internal(v_org, p_season, p_month, p_team) r
     where p_status is null or r.report_status = p_status;
end;
$$;

-- Every month of the season (first month of starts_on .. ends_on), per member:
-- expected (due), received (cash in the month), applied, open, status.
create or replace function public.club_membership_season_overview(p_season uuid, p_team uuid default null)
returns table (membership_id uuid, month date, due_in_month numeric, received_in_month numeric,
               applied_to_month numeric, open_for_month numeric, overdue_amount numeric, paid_to_date numeric,
               season_balance numeric, report_status text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare v_org uuid; se public.seasons; m date;
begin
  v_org := public.club_membership_report_check(p_season, null);
  if p_team is not null and not exists (select 1 from public.teams t where t.id = p_team and t.org_id = v_org) then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into se from public.seasons where id = p_season;
  m := date_trunc('month', se.starts_on)::date;
  while m <= se.ends_on loop
    return query
      select r.membership_id, m, r.due_in_month, r.received_in_month, r.applied_to_month, r.open_for_month,
             r.overdue_amount, r.paid_to_date, r.season_balance, r.report_status
        from public.club_membership_report_internal(v_org, p_season, m, p_team) r;
    m := (m + interval '1 month')::date;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Accounting transactions (accountant export)
-- ---------------------------------------------------------------------------
create or replace function public.accounting_transactions(
  p_from date, p_to date, p_entity uuid default null, p_category text default null)
returns table (
  kind text, txn_date date, document_number text, invoice_id uuid, invoice_number text, invoice_reference text,
  payment_reference text, category text, category_label text, billing_entity_id uuid, billing_entity_name text,
  source_label text, family_name text, payer_name text, description text, method text, status text,
  amount numeric, currency text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid := public.current_org_id();
  v_tz  text;
  v_from timestamptz;
  v_to   timestamptz;
begin
  if v_org is null or not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then raise exception 'INVALID_DATE' using errcode = 'P0001'; end if;
  if p_category is not null and not public.is_billing_activity(p_category) then raise exception 'INVALID_ACTIVITY' using errcode = 'P0001'; end if;
  v_tz := coalesce(public.training_org_tz(v_org), 'Europe/Zurich');
  v_from := (p_from::timestamp) at time zone v_tz;
  v_to   := ((p_to + 1)::timestamp) at time zone v_tz;

  return query
  with inv as (
    select i.*, f.name as fam_name,
           coalesce(i.billing_entity_snapshot->>'name', e.name) as entity_name,
           case when i.activity = 'selection' then coalesce(nullif(btrim(pr.series), ''), pr.name) end as sel_label
      from public.invoices i
      left join public.families f on f.id = i.family_id
      left join public.billing_entities e on e.id = i.billing_entity_id
      left join public.programs pr on pr.id = i.program_id
     where i.org_id = v_org
       and i.status::text <> 'draft'
       and (p_entity is null or i.billing_entity_id = p_entity)
       and (p_category is null or i.activity = p_category)
  )
  select 'invoice'::text, (inv.issued_at at time zone v_tz)::date, inv.number, inv.id, inv.number, inv.payment_reference,
         null::text, inv.activity, inv.sel_label, inv.billing_entity_id, inv.entity_name, inv.source_label, inv.fam_name,
         inv.payer_name, inv.description, null::text, inv.status::text, inv.total_chf::numeric, inv.currency
    from inv
   where inv.issued_at >= v_from and inv.issued_at < v_to
  union all
  select a.kind, (a.created_at at time zone v_tz)::date, a.number, inv.id, inv.number, inv.payment_reference,
         null::text, inv.activity, inv.sel_label, inv.billing_entity_id, inv.entity_name, inv.source_label, inv.fam_name,
         inv.payer_name, coalesce(a.description, a.reason), null::text,
         case when a.voided_at is not null then 'void' else 'active' end,
         (case when a.kind = 'debit_note' then a.amount else -a.amount end)::numeric, a.currency
    from public.invoice_adjustments a join inv on inv.id = a.invoice_id
   where a.org_id = v_org and a.created_at >= v_from and a.created_at < v_to
  union all
  select case when p.method_detail = 'reversal' or p.reverses_payment_id is not null then 'reversal'
              when p.amount_chf < 0 then 'refund' else 'payment' end,
         (coalesce(p.paid_at, p.created_at) at time zone v_tz)::date, null::text, inv.id, inv.number, inv.payment_reference,
         coalesce(nullif(p.qr_reference, ''), r.reference, p.stripe_payment_intent_id), inv.activity, inv.sel_label,
         inv.billing_entity_id, inv.entity_name, inv.source_label, inv.fam_name, coalesce(r.payer_name, inv.payer_name),
         p.notes, p.method::text, p.status::text, p.amount_chf::numeric, p.currency
    from public.payments p
    join inv on inv.id = p.invoice_id
    left join public.payment_receipts r on r.id = p.receipt_id
   where p.org_id = v_org
     and (p.status = 'succeeded' or (p.status in ('refunded', 'partially_refunded') and p.amount_chf < 0))
     and coalesce(p.paid_at, p.created_at) >= v_from and coalesce(p.paid_at, p.created_at) < v_to
   order by 2, 5, 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Last accounting exports (from audit_logs; finance may not read audit_logs)
-- ---------------------------------------------------------------------------
create or replace function public.accounting_last_exports()
returns table (kind text, ok boolean, exported_at timestamptz, details jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return query
    select distinct on (k.kind) k.kind, k.ok, k.created_at, k.details
      from (
        select case when l.action like 'accounting.export_failed.%' then substr(l.action, length('accounting.export_failed.') + 1)
                    else substr(l.action, length('accounting.export.') + 1) end as kind,
               l.action not like 'accounting.export_failed.%' as ok,
               l.created_at,
               -- only counts and parameters, never personal data
               coalesce(l.new_data, '{}'::jsonb) - 'error' as details
          from public.audit_logs l
         where l.org_id = v_org
           and (l.action like 'accounting.export.%' or l.action like 'accounting.export_failed.%')
      ) k
     order by k.kind, k.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.club_membership_report_internal(uuid, uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.club_membership_report_internal(uuid, uuid, date, uuid) to service_role;
revoke all on function public.club_membership_report_check(uuid, date) from public, anon;
grant execute on function public.club_membership_report_check(uuid, date) to authenticated, service_role;
revoke all on function public.club_membership_month_report(uuid, date, uuid, text) from public, anon;
grant execute on function public.club_membership_month_report(uuid, date, uuid, text) to authenticated, service_role;
revoke all on function public.club_membership_season_overview(uuid, uuid) from public, anon;
grant execute on function public.club_membership_season_overview(uuid, uuid) to authenticated, service_role;
revoke all on function public.accounting_transactions(date, date, uuid, text) from public, anon;
grant execute on function public.accounting_transactions(date, date, uuid, text) to authenticated, service_role;
revoke all on function public.accounting_last_exports() from public, anon;
grant execute on function public.accounting_last_exports() to authenticated, service_role;
