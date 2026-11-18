-- ============================================================================
-- Accounting: bank-file reconciliation, chart of accounts + journal exports,
-- period locks, refund & cancellation policies, dunning, family support.
-- Additive and idempotent. Builds on the money model of
-- 20250420095900_money_editing.sql (invoice_adjustments, append-only payments,
-- family_credit_entries, recompute_invoice) and the instalment / autopay model
-- of 20250420101000_instalments_recurring_autopay.sql.
--
--  1) Period locks (public.accounting_period_locks). "Close month" locks a
--     calendar month: issued invoices dated in it can no longer change their
--     booked fields, their lines are frozen, no payment can be dated in it and
--     no expense can be added / edited / deleted in it. Only a month that has
--     ended can be closed. Admins reopen with a reason; every close / reopen
--     is a row (history kept) plus an audit_logs entry.
--  2) Chart of accounts per club (public.accounting_accounts) and the mapping
--     of business events to accounts / VAT codes (public.accounting_mappings).
--     The default Swiss SME (KMU) chart is seeded from the app (names in the
--     user's language) through accounting_seed_chart(). Journal source data
--     and the open-items list come from finance-only RPCs.
--  3) Bank files (ISO 20022 camt.053 / camt.054): public.bank_statement_imports
--     (one row per file, unique per file hash) and public.bank_entries (one row
--     per credit, unique per bank reference -> re-importing a file or an
--     overlapping statement never books twice). Matching: structured reference
--     (QRR / SCOR) first, then the app's amount + name heuristic as a
--     suggestion. Booking a credit goes through record_offline_payment() (the
--     existing payment RPC) under a row lock, so one bank entry = at most one
--     payment. Debtor IBANs are kept as the last 4 characters only.
--  4) Refund & cancellation policies per product type (camp / training /
--     team_season / shop) and refund requests: the refund is computed from
--     the policy, issued as a credit note, and paid out as family credit, a
--     Stripe refund on the club's connected account, or a bank refund. The
--     family's IBAN for a bank refund lives in public.refund_bank_details,
--     readable by admin / finance of the club only (the request row carries
--     the last 4 characters).
--  5) Dunning: per-club steps (reminder 1 / 2 with optional fee / 3 final with
--     fee / collection flag), fees as debit notes, per-family pause, skips
--     what an instalment plan or autopay still handles. dunning_run() is
--     idempotent per invoice + level (unique notice rows).
--  6) Family support: discounts rule 'family_support' scoped to one family
--     (optional cap, validity, reason label) applied to issued invoices as a
--     credit note + applied_discounts row (once per invoice and discount);
--     external reimbursements tracker (city / canton / foundation / J+S).
--
-- Every table: org_id, RLS enabled + forced, a policy per verb, restrictive
-- tenant + suspension guards. Every RPC: SECURITY DEFINER, search_path pinned,
-- caller role + org checked; EXECUTE revoked from anon.
-- ============================================================================

-- ===========================================================================
-- 0) Shared helpers
-- ===========================================================================
-- IBAN check (ISO 13616 mod-97). Spaces ignored, upper-cased.
create or replace function public.iban_is_valid(p_iban text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := upper(regexp_replace(coalesce(p_iban, ''), '\s', '', 'g'));
  v_num text := '';
  v_rem int := 0;
  c text;
  i int;
begin
  if v !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' then return false; end if;
  v := substr(v, 5) || substr(v, 1, 4);
  for i in 1..length(v) loop
    c := substr(v, i, 1);
    if c ~ '[A-Z]' then v_num := (ascii(c) - 55)::text; else v_num := c; end if;
    for j in 1..length(v_num) loop
      v_rem := (v_rem * 10 + substr(v_num, j, 1)::int) % 97;
    end loop;
  end loop;
  return v_rem = 1;
end;
$$;

-- Restrictive tenant + suspension guards and base grants for a new table.
create or replace function public.accounting_guard_table(p_table text)
returns void
language plpgsql
set search_path = public
as $$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('alter table public.%I force row level security', p_table);
  execute format('drop policy if exists platform_tenant_isolation on public.%I', p_table);
  execute format(
    'create policy platform_tenant_isolation on public.%I as restrictive for all
       using (org_id = (select public.current_org_id()))
       with check (org_id = (select public.current_org_id()))', p_table);
  execute format('drop policy if exists platform_suspension_guard on public.%I', p_table);
  execute format(
    'create policy platform_suspension_guard on public.%I as restrictive for all
       using (not coalesce(org_id = any ((select public.suspended_org_ids())::uuid[]), false))
       with check (not coalesce(org_id = any ((select public.suspended_org_ids())::uuid[]), false))', p_table);
  execute format('revoke all on public.%I from public', p_table);
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format('revoke all on public.%I from anon', p_table);
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on public.%I from authenticated', p_table);
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute format('grant select, insert, update, delete on public.%I to service_role', p_table);
  end if;
end;
$$;
revoke all on function public.accounting_guard_table(text) from public;

-- ===========================================================================
-- 1) PERIOD LOCKS
-- ===========================================================================
create table if not exists public.accounting_period_locks (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  period_start   date not null,
  period_end     date not null,
  closed_at      timestamptz not null default now(),
  closed_by      uuid references public.profiles(id) on delete set null,
  reopened_at    timestamptz,
  reopened_by    uuid references public.profiles(id) on delete set null,
  reopen_reason  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint accounting_period_locks_chk check (
    extract(day from period_start) = 1
    and period_end = (period_start + interval '1 month' - interval '1 day')::date
    and (reopened_at is null or length(btrim(coalesce(reopen_reason, ''))) between 1 and 500))
);
create index if not exists idx_accounting_period_locks_org on public.accounting_period_locks(org_id);
create unique index if not exists uq_accounting_period_locks_active
  on public.accounting_period_locks(org_id, period_start) where reopened_at is null;

drop trigger if exists trg_accounting_period_locks_updated on public.accounting_period_locks;
create trigger trg_accounting_period_locks_updated before update on public.accounting_period_locks
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_accounting_period_locks on public.accounting_period_locks;
create trigger trg_audit_accounting_period_locks after insert or update or delete on public.accounting_period_locks
  for each row execute function public.audit_trigger();

select public.accounting_guard_table('accounting_period_locks');
drop policy if exists accounting_period_locks_select on public.accounting_period_locks;
create policy accounting_period_locks_select on public.accounting_period_locks for select
  using (public.is_finance_of(org_id));
drop policy if exists accounting_period_locks_insert on public.accounting_period_locks;
create policy accounting_period_locks_insert on public.accounting_period_locks for insert with check (false);
drop policy if exists accounting_period_locks_update on public.accounting_period_locks;
create policy accounting_period_locks_update on public.accounting_period_locks for update using (false) with check (false);
drop policy if exists accounting_period_locks_delete on public.accounting_period_locks;
create policy accounting_period_locks_delete on public.accounting_period_locks for delete using (false);
grant select on public.accounting_period_locks to authenticated;

-- Is p_date inside a closed month of p_org?
create or replace function public.accounting_period_closed(p_org uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org is not null and p_date is not null and exists (
    select 1 from public.accounting_period_locks
     where org_id = p_org and reopened_at is null
       and p_date between period_start and period_end);
$$;

-- Close one month (admin / finance). Idempotent.
create or replace function public.accounting_close_period(p_month date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date;
  v_id    uuid;
begin
  if not public.is_finance_of(v_org) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_month is null then raise exception 'INVALID_PERIOD' using errcode = 'P0001'; end if;
  if v_end >= current_date then raise exception 'PERIOD_NOT_ENDED' using errcode = 'P0001'; end if;
  select id into v_id from public.accounting_period_locks
   where org_id = v_org and period_start = v_start and reopened_at is null;
  if found then return jsonb_build_object('lock_id', v_id, 'already_closed', true); end if;
  insert into public.accounting_period_locks (org_id, period_start, period_end, closed_by)
  values (v_org, v_start, v_end, auth.uid())
  returning id into v_id;
  perform public.money_audit(v_org, 'PERIOD_CLOSED', 'accounting_period_locks', v_id, null,
    jsonb_build_object('period_start', v_start, 'period_end', v_end));
  return jsonb_build_object('lock_id', v_id, 'already_closed', false);
end;
$$;

-- Reopen a closed month (admin only, reason required).
create or replace function public.accounting_reopen_period(p_month date, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_start date := date_trunc('month', p_month)::date;
  v_id    uuid;
begin
  if v_org is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if length(btrim(p_reason)) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  select id into v_id from public.accounting_period_locks
   where org_id = v_org and period_start = v_start and reopened_at is null
   for update;
  if not found then raise exception 'PERIOD_NOT_CLOSED' using errcode = 'P0002'; end if;
  update public.accounting_period_locks
     set reopened_at = now(), reopened_by = auth.uid(), reopen_reason = btrim(p_reason)
   where id = v_id;
  perform public.money_audit(v_org, 'PERIOD_REOPENED', 'accounting_period_locks', v_id,
    jsonb_build_object('period_start', v_start),
    jsonb_build_object('period_start', v_start, 'reason', btrim(p_reason)));
  return jsonb_build_object('lock_id', v_id);
end;
$$;

-- Enforcement triggers ------------------------------------------------------
-- Invoices: an issued invoice dated in a closed month keeps its booked
-- fields (status / payment state / reminders still move). No new invoice
-- can be dated in a closed month; none can be deleted.
create or replace function public.accounting_lock_invoices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keys constant text[] := array['number', 'family_id', 'currency', 'total_chf', 'subtotal_amount', 'tax_rate',
    'tax_amount', 'tax_inclusive', 'reverse_charge', 'issued_at', 'payment_reference', 'program_id', 'athlete_id', 'description'];
  k text;
begin
  if tg_op = 'INSERT' then
    if new.status::text <> 'draft' and public.accounting_period_closed(new.org_id, new.issued_at::date) then
      raise exception 'PERIOD_CLOSED' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status::text <> 'draft' and public.accounting_period_closed(old.org_id, old.issued_at::date) then
      raise exception 'PERIOD_CLOSED' using errcode = 'P0001';
    end if;
    return old;
  end if;
  -- UPDATE
  if old.status::text <> 'draft' and public.accounting_period_closed(old.org_id, old.issued_at::date) then
    foreach k in array v_keys loop
      if (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
        raise exception 'PERIOD_CLOSED' using errcode = 'P0001';
      end if;
    end loop;
  end if;
  if new.status::text <> 'draft' and new.issued_at is distinct from old.issued_at
     and public.accounting_period_closed(new.org_id, new.issued_at::date) then
    raise exception 'PERIOD_CLOSED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_accounting_lock_invoices on public.invoices;
create trigger trg_accounting_lock_invoices before insert or update or delete on public.invoices
  for each row execute function public.accounting_lock_invoices();

create or replace function public.accounting_lock_invoice_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv uuid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
begin
  if exists (select 1 from public.invoices i
              where i.id = v_inv and i.status::text <> 'draft'
                and public.accounting_period_closed(i.org_id, i.issued_at::date)) then
    raise exception 'PERIOD_CLOSED' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists trg_accounting_lock_invoice_items on public.invoice_items;
create trigger trg_accounting_lock_invoice_items before insert or update or delete on public.invoice_items
  for each row execute function public.accounting_lock_invoice_items();

-- Payments: no payment row may be dated in a closed month (reversals of old
-- payments are dated today, so voiding still works).
create or replace function public.accounting_lock_payments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.accounting_period_closed(new.org_id, coalesce(new.paid_at, now())::date) then
    raise exception 'PERIOD_CLOSED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_accounting_lock_payments on public.payments;
create trigger trg_accounting_lock_payments before insert on public.payments
  for each row execute function public.accounting_lock_payments();

create or replace function public.accounting_lock_expenses()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and public.accounting_period_closed(old.org_id, old.expense_date) then
    raise exception 'PERIOD_CLOSED' using errcode = 'P0001';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and public.accounting_period_closed(new.org_id, new.expense_date) then
    raise exception 'PERIOD_CLOSED' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists trg_accounting_lock_expenses on public.expenses;
create trigger trg_accounting_lock_expenses before insert or update or delete on public.expenses
  for each row execute function public.accounting_lock_expenses();

-- ===========================================================================
-- 2) CHART OF ACCOUNTS + MAPPINGS
-- ===========================================================================
create table if not exists public.accounting_accounts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  number      text not null,
  name        text not null,
  type        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint accounting_accounts_chk check (
    number ~ '^[0-9A-Za-z.\-]{1,20}$' and length(btrim(name)) between 1 and 120
    and type in ('asset', 'liability', 'equity', 'income', 'expense'))
);
create index if not exists idx_accounting_accounts_org on public.accounting_accounts(org_id);
create unique index if not exists uq_accounting_accounts_number on public.accounting_accounts(org_id, number);

-- key: bank | cash | receivables | stripe_clearing | stripe_fees | vat_payable |
--      family_credit | payables | writeoff | dunning_fees |
--      income.<camp|training|team_season|shop|membership|other> |
--      expense.default | expense.<expense_category uuid> | vat.<rate> (vat_code only)
create table if not exists public.accounting_mappings (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  key             text not null,
  account_number  text,
  vat_code        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint accounting_mappings_chk check (
    key ~ '^(bank|cash|receivables|stripe_clearing|stripe_fees|vat_payable|family_credit|payables|writeoff|dunning_fees|income\.(camp|training|team_season|shop|membership|other)|expense\.(default|[0-9a-f-]{36})|vat\.[0-9]{1,2}(\.[0-9]{1,3})?)$'
    and (account_number is null or account_number ~ '^[0-9A-Za-z.\-]{1,20}$')
    and (vat_code is null or vat_code ~ '^[0-9A-Za-z._\-]{1,20}$'))
);
create index if not exists idx_accounting_mappings_org on public.accounting_mappings(org_id);
create unique index if not exists uq_accounting_mappings_key on public.accounting_mappings(org_id, key);

do $$
declare v_t text;
begin
  foreach v_t in array array['accounting_accounts', 'accounting_mappings'] loop
    execute format('drop trigger if exists trg_%s_updated on public.%I', v_t, v_t);
    execute format('create trigger trg_%s_updated before update on public.%I for each row execute function public.set_updated_at()', v_t, v_t);
    execute format('drop trigger if exists trg_audit_%s on public.%I', v_t, v_t);
    execute format('create trigger trg_audit_%s after insert or update or delete on public.%I for each row execute function public.audit_trigger()', v_t, v_t);
    perform public.accounting_guard_table(v_t);
    execute format('drop policy if exists %s_select on public.%I', v_t, v_t);
    execute format('create policy %s_select on public.%I for select using (public.is_finance_of(org_id))', v_t, v_t);
    execute format('drop policy if exists %s_insert on public.%I', v_t, v_t);
    execute format('create policy %s_insert on public.%I for insert with check (public.is_finance_of(org_id))', v_t, v_t);
    execute format('drop policy if exists %s_update on public.%I', v_t, v_t);
    execute format('create policy %s_update on public.%I for update using (public.is_finance_of(org_id)) with check (public.is_finance_of(org_id))', v_t, v_t);
    execute format('drop policy if exists %s_delete on public.%I', v_t, v_t);
    execute format('create policy %s_delete on public.%I for delete using (public.is_finance_of(org_id))', v_t, v_t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', v_t);
  end loop;
end $$;

-- Pre-fill the chart + mappings (only what is missing; never overwrites).
-- p_accounts: [{number, name, type}], p_mappings: [{key, account_number, vat_code}]
create or replace function public.accounting_seed_chart(p_accounts jsonb, p_mappings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  a jsonb;
  n_acc int := 0;
  n_map int := 0;
  n int;
begin
  if not public.is_finance_of(v_org) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_accounts, '[]')) <> 'array' or jsonb_typeof(coalesce(p_mappings, '[]')) <> 'array'
     or jsonb_array_length(coalesce(p_accounts, '[]')) > 300 or jsonb_array_length(coalesce(p_mappings, '[]')) > 300 then
    raise exception 'INVALID_PAYLOAD' using errcode = 'P0001';
  end if;
  for a in select * from jsonb_array_elements(coalesce(p_accounts, '[]')) loop
    insert into public.accounting_accounts (org_id, number, name, type)
    values (v_org, btrim(a->>'number'), btrim(a->>'name'), a->>'type')
    on conflict (org_id, number) do nothing;
    get diagnostics n = row_count; n_acc := n_acc + n;
  end loop;
  for a in select * from jsonb_array_elements(coalesce(p_mappings, '[]')) loop
    insert into public.accounting_mappings (org_id, key, account_number, vat_code)
    values (v_org, a->>'key', nullif(btrim(coalesce(a->>'account_number', '')), ''), nullif(btrim(coalesce(a->>'vat_code', '')), ''))
    on conflict (org_id, key) do nothing;
    get diagnostics n = row_count; n_map := n_map + n;
  end loop;
  perform public.money_audit(v_org, 'CHART_SEEDED', 'accounting_accounts', null, null,
    jsonb_build_object('accounts', n_acc, 'mappings', n_map));
  return jsonb_build_object('accounts', n_acc, 'mappings', n_map);
end;
$$;

-- Accounting product type of an invoice (income account selection).
create or replace function public.accounting_invoice_kind(p_invoice uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v text;
begin
  if exists (select 1 from public.training_bookings where invoice_id = p_invoice) then return 'training'; end if;
  v := public.invoice_product_type(p_invoice);
  return case v
    when 'camp' then 'camp'
    when 'season' then 'team_season'
    when 'training_package' then 'training'
    when 'shop' then 'shop'
    when 'recurring' then 'membership'
    else 'other' end;
end;
$$;

-- Everything the journal needs for a period, in one round trip (finance).
create or replace function public.accounting_journal_source(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_inv jsonb; v_adj jsonb; v_pay jsonb; v_exp jsonb;
begin
  if not public.is_finance_of(v_org) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'INVALID_PERIOD' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'number', i.number, 'date', i.issued_at::date, 'status', i.status,
           'total', i.total_chf, 'tax_rate', coalesce(i.tax_rate, 0), 'tax_amount', coalesce(i.tax_amount, 0),
           'currency', i.currency, 'family', f.name, 'kind', public.accounting_invoice_kind(i.id),
           'description', i.description) order by i.issued_at, i.number), '[]'::jsonb)
    into v_inv
    from public.invoices i left join public.families f on f.id = i.family_id
   where i.org_id = v_org and i.status::text <> 'draft'
     and i.issued_at::date between p_from and p_to
     and not (i.status::text in ('cancelled', 'void')
              and not exists (select 1 from public.invoice_adjustments a where a.invoice_id = i.id));

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'number', a.number, 'date', a.created_at::date, 'kind', a.kind, 'amount', a.amount,
           'tax_rate', a.tax_rate, 'currency', a.currency, 'invoice_id', a.invoice_id, 'invoice_number', i.number,
           'family', f.name, 'invoice_kind', public.accounting_invoice_kind(i.id), 'reason', a.reason,
           'voided_on', a.voided_at::date) order by a.created_at, a.number), '[]'::jsonb)
    into v_adj
    from public.invoice_adjustments a
    join public.invoices i on i.id = a.invoice_id
    left join public.families f on f.id = i.family_id
   where a.org_id = v_org
     and (a.created_at::date between p_from and p_to or a.voided_at::date between p_from and p_to);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'date', p.paid_at::date, 'amount', p.amount_chf, 'currency', p.currency, 'method', p.method,
           'method_detail', p.method_detail, 'stripe', (p.stripe_payment_intent_id is not null or p.stripe_charge_id is not null
                                                       or p.stripe_account_id is not null),
           'fee', p.application_fee_amount, 'invoice_id', p.invoice_id, 'invoice_number', i.number, 'family', f.name,
           'reference', p.qr_reference) order by p.paid_at, p.id), '[]'::jsonb)
    into v_pay
    from public.payments p
    join public.invoices i on i.id = p.invoice_id
    left join public.families f on f.id = i.family_id
   where p.org_id = v_org and p.paid_at is not null
     and p.paid_at::date between p_from and p_to
     and (p.status = 'succeeded' or (p.status in ('refunded', 'partially_refunded') and p.amount_chf < 0));

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'date', e.expense_date, 'amount', e.amount, 'currency', e.currency, 'category_id', e.category_id,
           'category', c.name, 'description', e.description, 'status', e.status, 'method', e.payment_method,
           'supplier', s.name) order by e.expense_date, e.id), '[]'::jsonb)
    into v_exp
    from public.expenses e
    left join public.expense_categories c on c.id = e.category_id
    left join public.expense_suppliers s on s.id = e.supplier_id
   where e.org_id = v_org and e.deleted_at is null and e.expense_date between p_from and p_to;

  return jsonb_build_object('invoices', v_inv, 'adjustments', v_adj, 'payments', v_pay, 'expenses', v_exp);
end;
$$;

-- Open items (debtors) at the end of p_date (finance).
create or replace function public.accounting_open_items(p_date date)
returns table (invoice_id uuid, number text, family_id uuid, family_name text, issued_on date, due_date date,
               currency text, amount_due numeric, paid numeric, open_amount numeric, days_overdue int, dunning_level int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if not public.is_finance_of(v_org) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return query
  with base as (
    select i.id, i.number, i.family_id, f.name as fname, i.issued_at::date as issued_on, i.due_date, i.currency,
           i.total_chf + coalesce((
             select sum(case when a.kind = 'debit_note' then a.amount else -a.amount end)
               from public.invoice_adjustments a
              where a.invoice_id = i.id and a.created_at::date <= p_date
                and (a.voided_at is null or a.voided_at::date > p_date)), 0) as due,
           coalesce((
             select sum(p.amount_chf) from public.payments p
              where p.invoice_id = i.id and p.paid_at::date <= p_date
                and (p.status = 'succeeded' or (p.status in ('refunded', 'partially_refunded') and p.amount_chf < 0))), 0) as paid
      from public.invoices i left join public.families f on f.id = i.family_id
     where i.org_id = v_org and i.status::text not in ('draft')
       and i.issued_at::date <= p_date
  )
  select b.id, b.number, b.family_id, b.fname, b.issued_on, b.due_date, b.currency, b.due, b.paid, b.due - b.paid,
         greatest(0, p_date - b.due_date)::int,
         coalesce((select c.level from public.dunning_cases c where c.invoice_id = b.id), 0)::int
    from base b
   where b.due - b.paid > 0
   order by b.fname nulls last, b.issued_on, b.number;
end;
$$;

-- ===========================================================================
-- 3) BANK FILES (camt.053 / camt.054)
-- ===========================================================================
create table if not exists public.bank_statement_imports (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  file_name        text not null,
  file_sha256      text not null,
  message_id       text,
  format           text not null,
  account_last4    text,
  statement_from   date,
  statement_to     date,
  entry_count      integer not null default 0,
  duplicate_count  integer not null default 0,
  skipped_count    integer not null default 0,
  matched_count    integer not null default 0,
  booked_count     integer not null default 0,
  total_amount     numeric(14,2) not null default 0,
  currency         text,
  imported_by      uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint bank_statement_imports_chk check (
    length(btrim(file_name)) between 1 and 200 and file_sha256 ~ '^[0-9a-f]{64}$'
    and format in ('camt.053', 'camt.054')
    and (message_id is null or length(message_id) <= 140)
    and (account_last4 is null or account_last4 ~ '^[0-9A-Z]{1,4}$')
    and (currency is null or currency ~ '^[A-Z]{3}$'))
);
create index if not exists idx_bank_statement_imports_org on public.bank_statement_imports(org_id, created_at desc);
create unique index if not exists uq_bank_statement_imports_file on public.bank_statement_imports(org_id, file_sha256);

create table if not exists public.bank_entries (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  import_id          uuid not null references public.bank_statement_imports(id) on delete restrict,
  bank_ref           text not null,
  amount             numeric(12,2) not null,
  currency           text not null,
  booking_date       date,
  value_date         date,
  reference          text,
  reference_type     text not null default 'NON',
  debtor_name        text,
  debtor_iban_last4  text,
  remittance         text,
  status             text not null default 'unmatched',
  match_kind         text,
  match_score        numeric(5,2),
  invoice_id         uuid references public.invoices(id) on delete restrict,
  payment_id         uuid references public.payments(id) on delete restrict,
  booked_by          uuid references public.profiles(id) on delete set null,
  booked_at          timestamptz,
  ignored_reason     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint bank_entries_chk check (
    amount > 0 and currency ~ '^[A-Z]{3}$' and length(bank_ref) between 1 and 200
    and reference_type in ('QRR', 'SCOR', 'NON')
    and (reference is null or length(reference) <= 40)
    and (debtor_name is null or length(debtor_name) <= 140)
    and (debtor_iban_last4 is null or debtor_iban_last4 ~ '^[0-9A-Z]{1,4}$')
    and (remittance is null or length(remittance) <= 500)
    and status in ('unmatched', 'suggested', 'booked', 'ignored')
    and (match_kind is null or match_kind in ('reference', 'heuristic', 'manual'))
    and (status <> 'booked' or (payment_id is not null and invoice_id is not null))
    and (status <> 'suggested' or invoice_id is not null)
    and (ignored_reason is null or length(ignored_reason) <= 500))
);
create index if not exists idx_bank_entries_org on public.bank_entries(org_id, status);
create index if not exists idx_bank_entries_import on public.bank_entries(import_id);
create index if not exists idx_bank_entries_invoice on public.bank_entries(invoice_id) where invoice_id is not null;
create unique index if not exists uq_bank_entries_ref on public.bank_entries(org_id, bank_ref);
create unique index if not exists uq_bank_entries_payment on public.bank_entries(payment_id) where payment_id is not null;

do $$
declare v_t text;
begin
  foreach v_t in array array['bank_statement_imports', 'bank_entries'] loop
    execute format('drop trigger if exists trg_%s_updated on public.%I', v_t, v_t);
    execute format('create trigger trg_%s_updated before update on public.%I for each row execute function public.set_updated_at()', v_t, v_t);
    execute format('drop trigger if exists trg_audit_%s on public.%I', v_t, v_t);
    execute format('create trigger trg_audit_%s after insert or update or delete on public.%I for each row execute function public.audit_trigger()', v_t, v_t);
    perform public.accounting_guard_table(v_t);
    execute format('drop policy if exists %s_select on public.%I', v_t, v_t);
    execute format('create policy %s_select on public.%I for select using (public.is_finance_of(org_id))', v_t, v_t);
    execute format('drop policy if exists %s_insert on public.%I', v_t, v_t);
    execute format('create policy %s_insert on public.%I for insert with check (false)', v_t, v_t);
    execute format('drop policy if exists %s_update on public.%I', v_t, v_t);
    execute format('create policy %s_update on public.%I for update using (false) with check (false)', v_t, v_t);
    execute format('drop policy if exists %s_delete on public.%I', v_t, v_t);
    execute format('create policy %s_delete on public.%I for delete using (false)', v_t, v_t);
    execute format('grant select on public.%I to authenticated', v_t);
  end loop;
end $$;

-- Is an invoice open for a bank credit in p_currency?
create or replace function public.bank_invoice_payable(p_org uuid, p_invoice uuid, p_currency text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.invoices
                  where id = p_invoice and org_id = p_org and currency = upper(p_currency)
                    and status::text not in ('draft', 'cancelled', 'void'));
$$;

-- Internal: book one bank entry on an invoice through record_offline_payment.
-- Idempotent: the entry row is locked and an already booked entry returns
-- its payment. The caller checked finance + org.
create or replace function public.bank_entry_book_internal(p_entry uuid, p_invoice uuid, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  e      public.bank_entries;
  v_res  jsonb;
  v_pay  uuid;
begin
  select * into e from public.bank_entries where id = p_entry for update;
  if not found then raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002'; end if;
  if e.payment_id is not null then return e.payment_id; end if;
  if e.status = 'ignored' then raise exception 'ENTRY_IGNORED' using errcode = 'P0001'; end if;
  if p_invoice is null then raise exception 'INVOICE_REQUIRED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.invoices where id = p_invoice and org_id = e.org_id) then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.bank_invoice_payable(e.org_id, p_invoice, e.currency) then
    raise exception 'INVOICE_NOT_PAYABLE' using errcode = 'P0001';
  end if;

  v_res := public.record_offline_payment(
    p_invoice, e.amount,
    case when e.reference_type in ('QRR', 'SCOR') then 'qr_bill' else 'bank_transfer' end,
    least(coalesce(e.value_date, e.booking_date, current_date), current_date),
    coalesce(e.reference, left(e.bank_ref, 100)),
    'bank:' || left(e.bank_ref, 180));
  v_pay := (v_res->>'payment_id')::uuid;

  update public.bank_entries
     set status = 'booked', invoice_id = p_invoice, payment_id = v_pay, booked_by = auth.uid(), booked_at = now(),
         match_kind = coalesce(case when p_kind = 'manual' and invoice_id is distinct from p_invoice then 'manual' end, match_kind, p_kind)
   where id = e.id;
  update public.bank_statement_imports
     set booked_count = (select count(*) from public.bank_entries where import_id = e.import_id and status = 'booked')
   where id = e.import_id;
  perform public.money_audit(e.org_id, 'BANK_ENTRY_BOOKED', 'bank_entries', e.id, null,
    jsonb_build_object('invoice_id', p_invoice, 'payment_id', v_pay, 'amount', e.amount, 'currency', e.currency,
                       'bank_ref', e.bank_ref, 'kind', p_kind));
  return v_pay;
end;
$$;

-- Import the credits of one parsed bank file (finance). p_meta:
--   {file_name, file_sha256, message_id, format, account_last4, statement_from, statement_to, skipped_count}
-- p_entries: [{bank_ref, amount, currency, booking_date, value_date, reference, reference_type,
--              debtor_name, debtor_iban_last4, remittance, suggested_invoice_id, score}]
create or replace function public.bank_import(p_meta jsonb, p_entries jsonb, p_auto_book boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid := public.current_org_id();
  v_imp     uuid;
  v_id      uuid;
  v_inv     uuid;
  v_sug     uuid;
  v_ref     text;
  v_rtype   text;
  v_cur     text;
  v_status  text;
  v_kind    text;
  e         jsonb;
  n_new     int := 0;
  n_dup     int := 0;
  n_match   int := 0;
  n_booked  int := 0;
  n_failed  int := 0;
  v_total   numeric := 0;
begin
  if not public.is_finance_of(v_org) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_entries, 'null')) <> 'array' or jsonb_array_length(p_entries) > 5000 then
    raise exception 'INVALID_PAYLOAD' using errcode = 'P0001';
  end if;

  select id into v_imp from public.bank_statement_imports
   where org_id = v_org and file_sha256 = lower(p_meta->>'file_sha256');
  if found then return jsonb_build_object('import_id', v_imp, 'duplicate_file', true); end if;

  insert into public.bank_statement_imports
    (org_id, file_name, file_sha256, message_id, format, account_last4, statement_from, statement_to, skipped_count, imported_by)
  values (v_org, left(btrim(coalesce(p_meta->>'file_name', 'bank.xml')), 200), lower(p_meta->>'file_sha256'),
          left(nullif(btrim(coalesce(p_meta->>'message_id', '')), ''), 140), p_meta->>'format',
          nullif(upper(right(regexp_replace(coalesce(p_meta->>'account_last4', ''), '\s', '', 'g'), 4)), ''),
          nullif(p_meta->>'statement_from', '')::date, nullif(p_meta->>'statement_to', '')::date,
          greatest(coalesce((p_meta->>'skipped_count')::int, 0), 0), auth.uid())
  returning id into v_imp;

  for e in select * from jsonb_array_elements(p_entries) loop
    v_cur := upper(coalesce(e->>'currency', ''));
    v_ref := nullif(upper(regexp_replace(coalesce(e->>'reference', ''), '\s', '', 'g')), '');
    v_rtype := coalesce(nullif(e->>'reference_type', ''), 'NON');
    if v_rtype not in ('QRR', 'SCOR', 'NON') then v_rtype := 'NON'; end if;

    insert into public.bank_entries
      (org_id, import_id, bank_ref, amount, currency, booking_date, value_date, reference, reference_type,
       debtor_name, debtor_iban_last4, remittance)
    values (v_org, v_imp, left(btrim(e->>'bank_ref'), 200), round((e->>'amount')::numeric, 2), v_cur,
            nullif(e->>'booking_date', '')::date, nullif(e->>'value_date', '')::date, left(v_ref, 40), v_rtype,
            left(nullif(btrim(coalesce(e->>'debtor_name', '')), ''), 140),
            nullif(upper(right(regexp_replace(coalesce(e->>'debtor_iban_last4', ''), '\s', '', 'g'), 4)), ''),
            left(nullif(btrim(coalesce(e->>'remittance', '')), ''), 500))
    on conflict (org_id, bank_ref) do nothing
    returning id into v_id;
    if v_id is null then n_dup := n_dup + 1; continue; end if;
    n_new := n_new + 1;
    v_total := v_total + round((e->>'amount')::numeric, 2);

    -- 1. structured reference (authoritative, re-derived here)
    v_inv := null; v_kind := null; v_status := 'unmatched';
    if v_ref is not null then
      v_inv := public.find_invoice_by_reference(v_org, v_ref);
      if v_inv is not null and public.bank_invoice_payable(v_org, v_inv, v_cur) then
        v_kind := 'reference'; v_status := 'suggested';
      else
        v_inv := null;
      end if;
    end if;
    -- 2. the app's heuristic suggestion (checked: same org, payable, same currency)
    if v_inv is null then
      v_sug := nullif(e->>'suggested_invoice_id', '')::uuid;
      if v_sug is not null and public.bank_invoice_payable(v_org, v_sug, v_cur) then
        v_inv := v_sug; v_kind := 'heuristic'; v_status := 'suggested';
      end if;
    end if;
    if v_inv is not null then
      update public.bank_entries
         set status = v_status, match_kind = v_kind, invoice_id = v_inv,
             match_score = case when v_kind = 'reference' then 100 else least(greatest(coalesce((e->>'score')::numeric, 0), 0), 99) end
       where id = v_id;
      n_match := n_match + 1;
      if p_auto_book and v_kind = 'reference' then
        begin
          perform public.bank_entry_book_internal(v_id, v_inv, 'reference');
          n_booked := n_booked + 1;
        exception when others then
          -- e.g. PERIOD_CLOSED: stays a suggestion for a person to look at
          n_failed := n_failed + 1;
        end;
      end if;
    end if;
    v_id := null;
  end loop;

  update public.bank_statement_imports
     set entry_count = n_new, duplicate_count = n_dup, matched_count = n_match, booked_count = n_booked,
         total_amount = v_total,
         currency = (select case when count(distinct currency) = 1 then min(currency) end from public.bank_entries where import_id = v_imp)
   where id = v_imp;

  perform public.money_audit(v_org, 'BANK_FILE_IMPORTED', 'bank_statement_imports', v_imp, null,
    jsonb_build_object('format', p_meta->>'format', 'entries', n_new, 'duplicates', n_dup, 'matched', n_match,
                       'booked', n_booked, 'book_failed', n_failed, 'total', v_total));
  return jsonb_build_object('import_id', v_imp, 'duplicate_file', false, 'entries', n_new, 'duplicates', n_dup,
                            'matched', n_match, 'booked', n_booked, 'book_failed', n_failed);
end;
$$;

-- One-click confirm (suggested invoice) or manual assignment (p_invoice).
create or replace function public.bank_entry_confirm(p_entry uuid, p_invoice uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e     public.bank_entries;
  v_pay uuid;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into e from public.bank_entries where id = p_entry and org_id = public.current_org_id();
  if not found then raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002'; end if;
  v_pay := public.bank_entry_book_internal(e.id, coalesce(p_invoice, e.invoice_id),
             case when p_invoice is not null and p_invoice is distinct from e.invoice_id then 'manual' else coalesce(e.match_kind, 'manual') end);
  return jsonb_build_object('entry_id', e.id, 'payment_id', v_pay,
                            'invoice_status', (select i.status from public.invoices i join public.bank_entries b on b.invoice_id = i.id where b.id = e.id));
end;
$$;

-- Not a club payment (e.g. a transfer between own accounts): ignore with a reason.
create or replace function public.bank_entry_ignore(p_entry uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare e public.bank_entries;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into e from public.bank_entries where id = p_entry and org_id = public.current_org_id() for update;
  if not found then raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002'; end if;
  if e.status = 'booked' then raise exception 'ENTRY_BOOKED' using errcode = 'P0001'; end if;
  update public.bank_entries set status = 'ignored', ignored_reason = left(btrim(p_reason), 500), invoice_id = null, match_kind = null
   where id = e.id;
  perform public.money_audit(e.org_id, 'BANK_ENTRY_IGNORED', 'bank_entries', e.id, null,
    jsonb_build_object('reason', btrim(p_reason), 'amount', e.amount));
  return jsonb_build_object('entry_id', e.id, 'status', 'ignored');
end;
$$;

-- Undo: a booked entry's payment is voided (reversal row) and the entry is
-- open again; an ignored entry becomes unmatched.
create or replace function public.bank_entry_reopen(p_entry uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare e public.bank_entries;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into e from public.bank_entries where id = p_entry and org_id = public.current_org_id() for update;
  if not found then raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002'; end if;
  if e.status = 'booked' then
    perform public.void_payment(e.payment_id, p_reason);
  end if;
  update public.bank_entries
     set status = 'unmatched', payment_id = null, invoice_id = null, match_kind = null, match_score = null,
         booked_by = null, booked_at = null, ignored_reason = null
   where id = e.id;
  update public.bank_statement_imports
     set booked_count = (select count(*) from public.bank_entries where import_id = e.import_id and status = 'booked')
   where id = e.import_id;
  perform public.money_audit(e.org_id, 'BANK_ENTRY_REOPENED', 'bank_entries', e.id,
    jsonb_build_object('status', e.status, 'payment_id', e.payment_id, 'invoice_id', e.invoice_id),
    jsonb_build_object('status', 'unmatched', 'reason', btrim(p_reason)));
  return jsonb_build_object('entry_id', e.id, 'status', 'unmatched');
end;
$$;

-- ===========================================================================
-- 4) REFUND & CANCELLATION POLICIES
-- ===========================================================================
create table if not exists public.refund_policies (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  product_type        text not null,
  full_until_days     integer,
  partial_percent     integer not null default 0,
  partial_until_days  integer,
  medical_mode        text not null default 'credit',
  medical_percent     integer not null default 100,
  notes               text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint refund_policies_chk check (
    product_type in ('camp', 'training', 'team_season', 'shop')
    and (full_until_days is null or full_until_days between 0 and 730)
    and partial_percent between 0 and 100
    and (partial_until_days is null or partial_until_days between 0 and 730)
    and (full_until_days is null or partial_until_days is null or partial_until_days <= full_until_days)
    and medical_mode in ('none', 'credit', 'refund', 'choice')
    and medical_percent between 0 and 100
    and (notes is null or length(notes) <= 2000))
);
create index if not exists idx_refund_policies_org on public.refund_policies(org_id);
create unique index if not exists uq_refund_policies_type on public.refund_policies(org_id, product_type);

drop trigger if exists trg_refund_policies_updated on public.refund_policies;
create trigger trg_refund_policies_updated before update on public.refund_policies
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_refund_policies on public.refund_policies;
create trigger trg_audit_refund_policies after insert or update or delete on public.refund_policies
  for each row execute function public.audit_trigger();
select public.accounting_guard_table('refund_policies');
-- Members of the club read the rules (shown to parents before they cancel).
drop policy if exists refund_policies_select on public.refund_policies;
create policy refund_policies_select on public.refund_policies for select using (org_id = public.current_org_id());
drop policy if exists refund_policies_insert on public.refund_policies;
create policy refund_policies_insert on public.refund_policies for insert with check (public.is_finance_of(org_id));
drop policy if exists refund_policies_update on public.refund_policies;
create policy refund_policies_update on public.refund_policies for update
  using (public.is_finance_of(org_id)) with check (public.is_finance_of(org_id));
drop policy if exists refund_policies_delete on public.refund_policies;
create policy refund_policies_delete on public.refund_policies for delete using (public.is_finance_of(org_id));
grant select, insert, update, delete on public.refund_policies to authenticated;

create table if not exists public.refund_requests (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations(id) on delete cascade,
  family_id               uuid not null references public.families(id) on delete restrict,
  invoice_id              uuid references public.invoices(id) on delete restrict,
  registration_id         uuid references public.registrations(id) on delete set null,
  booking_id              uuid references public.training_bookings(id) on delete set null,
  product_type            text not null,
  starts_on               date,
  days_before             integer,
  medical                 boolean not null default false,
  reason                  text,
  preference              text,
  policy_snapshot         jsonb,
  computed_percent        integer not null default 0,
  base_amount             numeric(12,2) not null default 0,
  computed_amount         numeric(12,2) not null default 0,
  final_amount            numeric(12,2),
  payout_amount           numeric(12,2),
  currency                text not null,
  override_reason         text,
  resolution              text,
  status                  text not null default 'requested',
  credit_note_id          uuid references public.invoice_adjustments(id) on delete set null,
  invoice_cancelled       boolean not null default false,
  refund_payment_id       uuid references public.payments(id) on delete set null,
  stripe_payment_intent   text,
  stripe_refund_id        text,
  stripe_error            text,
  iban_last4              text,
  requested_by            uuid references public.profiles(id) on delete set null,
  requested_at            timestamptz not null default now(),
  processed_by            uuid references public.profiles(id) on delete set null,
  processed_at            timestamptz,
  rejected_reason         text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint refund_requests_chk check (
    product_type in ('camp', 'training', 'team_season', 'shop')
    and currency ~ '^[A-Z]{3}$'
    and computed_percent between 0 and 100
    and base_amount >= 0 and computed_amount >= 0 and (final_amount is null or final_amount >= 0)
    and (preference is null or preference in ('family_credit', 'stripe_refund', 'bank_refund'))
    and (resolution is null or resolution in ('family_credit', 'stripe_refund', 'bank_refund', 'none'))
    and status in ('requested', 'processing', 'stripe_failed', 'completed', 'rejected')
    and (reason is null or length(reason) <= 1000)
    and (override_reason is null or length(override_reason) <= 500)
    and (rejected_reason is null or length(rejected_reason) <= 500)
    and (iban_last4 is null or iban_last4 ~ '^[0-9A-Z]{4}$')
    and num_nonnulls(registration_id, booking_id) <= 1)
);
create index if not exists idx_refund_requests_org on public.refund_requests(org_id, status);
create index if not exists idx_refund_requests_family on public.refund_requests(family_id);
create unique index if not exists uq_refund_requests_registration on public.refund_requests(registration_id)
  where registration_id is not null and status <> 'rejected';
create unique index if not exists uq_refund_requests_booking on public.refund_requests(booking_id)
  where booking_id is not null and status <> 'rejected';
create unique index if not exists uq_refund_requests_invoice_only on public.refund_requests(invoice_id)
  where registration_id is null and booking_id is null and status <> 'rejected';

drop trigger if exists trg_refund_requests_updated on public.refund_requests;
create trigger trg_refund_requests_updated before update on public.refund_requests
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_refund_requests on public.refund_requests;
create trigger trg_audit_refund_requests after insert or update or delete on public.refund_requests
  for each row execute function public.audit_trigger();
select public.accounting_guard_table('refund_requests');
drop policy if exists refund_requests_select on public.refund_requests;
create policy refund_requests_select on public.refund_requests for select
  using (public.is_finance_of(org_id) or (org_id = public.current_org_id() and public.is_guardian_of_family(family_id)));
drop policy if exists refund_requests_insert on public.refund_requests;
create policy refund_requests_insert on public.refund_requests for insert with check (false);
drop policy if exists refund_requests_update on public.refund_requests;
create policy refund_requests_update on public.refund_requests for update using (false) with check (false);
drop policy if exists refund_requests_delete on public.refund_requests;
create policy refund_requests_delete on public.refund_requests for delete using (false);
grant select on public.refund_requests to authenticated;

-- Full IBAN for a bank refund: admin / finance of the club only. No row
-- trigger audit (the IBAN must not land in audit_logs); the RPCs write a
-- redacted audit row instead.
create table if not exists public.refund_bank_details (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  refund_request_id  uuid not null references public.refund_requests(id) on delete cascade,
  account_holder     text not null,
  iban               text not null,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint refund_bank_details_chk check (
    length(btrim(account_holder)) between 1 and 140 and iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$')
);
create index if not exists idx_refund_bank_details_org on public.refund_bank_details(org_id);
create unique index if not exists uq_refund_bank_details_request on public.refund_bank_details(refund_request_id);
drop trigger if exists trg_refund_bank_details_updated on public.refund_bank_details;
create trigger trg_refund_bank_details_updated before update on public.refund_bank_details
  for each row execute function public.set_updated_at();
select public.accounting_guard_table('refund_bank_details');
drop policy if exists refund_bank_details_select on public.refund_bank_details;
create policy refund_bank_details_select on public.refund_bank_details for select using (public.is_finance_of(org_id));
drop policy if exists refund_bank_details_insert on public.refund_bank_details;
create policy refund_bank_details_insert on public.refund_bank_details for insert with check (false);
drop policy if exists refund_bank_details_update on public.refund_bank_details;
create policy refund_bank_details_update on public.refund_bank_details for update using (false) with check (false);
drop policy if exists refund_bank_details_delete on public.refund_bank_details;
create policy refund_bank_details_delete on public.refund_bank_details for delete using (false);
grant select on public.refund_bank_details to authenticated;

-- Percent refunded under a policy (mirrored in src/lib/accounting/refunds.ts).
--   medical (with certificate) and medical_mode <> 'none' -> medical_percent
--   unknown start date -> 0 (needs a person to decide)
--   days_before >= full_until_days -> 100
--   days_before >= partial_until_days -> partial_percent
--   otherwise 0
create or replace function public.refund_policy_percent(p public.refund_policies, p_days int, p_medical boolean)
returns int
language sql
immutable
as $$
  select case
    when p.id is null then 0
    when coalesce(p_medical, false) and p.medical_mode <> 'none' then p.medical_percent
    when p_days is null then 0
    when p.full_until_days is not null and p_days >= p.full_until_days then 100
    when p.partial_until_days is not null and p_days >= p.partial_until_days then p.partial_percent
    else 0 end;
$$;

-- What is being cancelled: product type, start, invoice, base amount.
create or replace function public.refund_subject(p_registration uuid, p_booking uuid, p_invoice uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r  record;
  b  record;
  v  public.invoices;
  v_type  text;
  v_start date;
  v_base  numeric;
  v_inv   uuid;
  v_fam   uuid;
  v_org   uuid;
  v_label text;
begin
  if num_nonnulls(p_registration, p_booking, p_invoice) <> 1 then raise exception 'INVALID_SUBJECT' using errcode = 'P0001'; end if;
  if p_registration is not null then
    select rg.*, p.kind::text as pkind, p.starts_on as pstart, p.name as pname, a.family_id as afamily,
           e.starts_on as estart
      into r
      from public.registrations rg
      join public.programs p on p.id = rg.program_id
      join public.athletes a on a.id = rg.athlete_id
      left join public.camp_editions e on e.id = rg.camp_edition_id
     where rg.id = p_registration;
    if not found then raise exception 'SUBJECT_NOT_FOUND' using errcode = 'P0002'; end if;
    v_org := r.org_id; v_fam := r.afamily; v_label := r.pname;
    v_type := case when r.camp_edition_id is not null or r.pkind = 'camp' then 'camp'
                   when r.pkind = 'recurring_team' then 'team_season' else 'training' end;
    v_start := coalesce(r.estart, r.pstart);
    v_inv := coalesce(r.invoice_id, (select id from public.invoices
                                       where registration_id = r.id and status::text not in ('draft', 'cancelled', 'void')
                                       order by issued_at desc limit 1));
    if v_inv is not null then select * into v from public.invoices where id = v_inv; end if;
    v_base := case when v_inv is null then 0
                   else least(coalesce(r.price_amount, v.total_chf + v.adjustments_total), v.total_chf + v.adjustments_total) end;
  elsif p_booking is not null then
    select tb.*, a.family_id as afamily, s.name as sname into b
      from public.training_bookings tb
      join public.athletes a on a.id = tb.athlete_id
      join public.training_services s on s.id = tb.service_id
     where tb.id = p_booking;
    if not found then raise exception 'SUBJECT_NOT_FOUND' using errcode = 'P0002'; end if;
    v_org := b.org_id; v_fam := b.afamily; v_label := b.sname; v_type := 'training';
    v_start := b.slot_start::date;
    v_inv := b.invoice_id;
    if v_inv is not null then select * into v from public.invoices where id = v_inv; end if;
    v_base := case when v_inv is null then 0
                   else least(coalesce(b.price_chf, v.total_chf + v.adjustments_total), v.total_chf + v.adjustments_total) end;
  else
    select * into v from public.invoices where id = p_invoice;
    if not found then raise exception 'SUBJECT_NOT_FOUND' using errcode = 'P0002'; end if;
    v_org := v.org_id; v_fam := v.family_id; v_inv := v.id; v_label := v.number;
    v_type := case public.accounting_invoice_kind(v.id)
                when 'camp' then 'camp' when 'shop' then 'shop' when 'team_season' then 'team_season'
                when 'membership' then 'team_season' else 'training' end;
    v_start := coalesce(public.invoice_activity_start(v.id),
                        (select starts_on from public.programs where id = v.program_id),
                        case when v_type = 'shop' then v.issued_at::date end);
    v_base := v.total_chf + v.adjustments_total;
  end if;
  return jsonb_build_object('org_id', v_org, 'family_id', v_fam, 'invoice_id', v_inv, 'product_type', v_type,
    'starts_on', v_start, 'base', greatest(coalesce(v_base, 0), 0), 'label', v_label,
    'currency', coalesce(v.currency, public.org_currency(v_org)));
end;
$$;

-- Quote a cancellation (guardian of the family or finance of the club).
create or replace function public.refund_quote(
  p_registration uuid default null, p_booking uuid default null, p_invoice uuid default null,
  p_medical boolean default false, p_on date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s        jsonb;
  pol      public.refund_policies;
  v_on     date := coalesce(p_on, current_date);
  v_days   int;
  v_pct    int;
  v_exp    int;
  v_base   numeric;
  v_refund numeric;
  v_due    numeric := 0;
  v_paid   numeric := 0;
  v_stripe boolean := false;
begin
  s := public.refund_subject(p_registration, p_booking, p_invoice);
  if (s->>'org_id')::uuid is distinct from public.current_org_id() then raise exception 'SUBJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_finance() or (p_invoice is null and public.is_guardian_of_family((s->>'family_id')::uuid))) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into pol from public.refund_policies
   where org_id = (s->>'org_id')::uuid and product_type = s->>'product_type' and is_active;
  v_days := case when s->>'starts_on' is null then null else (s->>'starts_on')::date - v_on end;
  v_pct := public.refund_policy_percent(pol, v_days, p_medical);
  v_exp := public.currency_exponent(s->>'currency');
  v_base := (s->>'base')::numeric;
  v_refund := round(v_base * v_pct / 100, v_exp);
  if s->>'invoice_id' is not null then
    v_due := public.invoice_amount_due((s->>'invoice_id')::uuid);
    v_paid := public.invoice_net_paid((s->>'invoice_id')::uuid);
    v_stripe := exists (select 1 from public.payments where invoice_id = (s->>'invoice_id')::uuid
                          and stripe_payment_intent_id is not null and amount_chf > 0 and status = 'succeeded');
  end if;
  return s || jsonb_build_object(
    'has_policy', pol.id is not null,
    'policy', case when pol.id is null then null else jsonb_build_object(
      'full_until_days', pol.full_until_days, 'partial_percent', pol.partial_percent,
      'partial_until_days', pol.partial_until_days, 'medical_mode', pol.medical_mode,
      'medical_percent', pol.medical_percent, 'notes', pol.notes) end,
    'days_before', v_days, 'percent', v_pct, 'medical', coalesce(p_medical, false),
    'refund', v_refund, 'amount_due', v_due, 'paid', v_paid,
    'payout', greatest(0, least(v_refund, v_paid - (v_due - least(v_refund, v_due)))),
    'still_owed', greatest(0, (v_due - least(v_refund, v_due)) - v_paid),
    'stripe_available', v_stripe,
    'needs_review', pol.id is null or (v_days is null and not coalesce(p_medical, false)));
end;
$$;

-- Cancel + request the refund (guardian or finance). Cancels the
-- registration / booking right away; the money moves when finance processes it.
-- p_payload: {registration_id | booking_id | invoice_id, medical, reason, preference, iban, account_holder}
create or replace function public.refund_request_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q       jsonb;
  v_reg   uuid := nullif(p_payload->>'registration_id', '')::uuid;
  v_book  uuid := nullif(p_payload->>'booking_id', '')::uuid;
  v_inv   uuid := nullif(p_payload->>'invoice_id', '')::uuid;
  v_med   boolean := coalesce((p_payload->>'medical')::boolean, false);
  v_pref  text := nullif(p_payload->>'preference', '');
  v_iban  text := upper(regexp_replace(coalesce(p_payload->>'iban', ''), '\s', '', 'g'));
  v_hold  text := btrim(coalesce(p_payload->>'account_holder', ''));
  v_id    uuid;
  v_org   uuid;
begin
  q := public.refund_quote(v_reg, v_book, v_inv, v_med, current_date);
  v_org := (q->>'org_id')::uuid;
  if v_pref is not null and v_pref not in ('family_credit', 'stripe_refund', 'bank_refund') then
    raise exception 'INVALID_PREFERENCE' using errcode = 'P0001';
  end if;
  if v_med and q->'policy'->>'medical_mode' = 'credit' then v_pref := 'family_credit'; end if;
  if v_pref = 'stripe_refund' and not (q->>'stripe_available')::boolean then
    raise exception 'STRIPE_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  if v_pref = 'bank_refund' then
    if not public.iban_is_valid(v_iban) then raise exception 'INVALID_IBAN' using errcode = 'P0001'; end if;
    if length(v_hold) = 0 or length(v_hold) > 140 then raise exception 'HOLDER_REQUIRED' using errcode = 'P0001'; end if;
  end if;
  if length(coalesce(p_payload->>'reason', '')) > 1000 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;

  if v_reg is not null then
    if exists (select 1 from public.registrations where id = v_reg and status = 'cancelled')
       and not public.is_finance() then
      raise exception 'ALREADY_CANCELLED' using errcode = 'P0001';
    end if;
  end if;
  if v_book is not null then
    if exists (select 1 from public.training_bookings where id = v_book and status in ('cancelled', 'completed', 'no_show'))
       and not public.is_finance() then
      raise exception 'ALREADY_CANCELLED' using errcode = 'P0001';
    end if;
  end if;

  begin
    insert into public.refund_requests
      (org_id, family_id, invoice_id, registration_id, booking_id, product_type, starts_on, days_before, medical,
       reason, preference, policy_snapshot, computed_percent, base_amount, computed_amount, currency, iban_last4,
       requested_by)
    values (v_org, (q->>'family_id')::uuid, (q->>'invoice_id')::uuid, v_reg, v_book, q->>'product_type',
            (q->>'starts_on')::date, (q->>'days_before')::int, v_med, nullif(btrim(coalesce(p_payload->>'reason', '')), ''),
            v_pref, q->'policy', (q->>'percent')::int, (q->>'base')::numeric, (q->>'refund')::numeric, q->>'currency',
            case when v_pref = 'bank_refund' then right(v_iban, 4) end, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'REQUEST_EXISTS' using errcode = 'P0001';
  end;

  if v_pref = 'bank_refund' then
    insert into public.refund_bank_details (org_id, refund_request_id, account_holder, iban, created_by)
    values (v_org, v_id, v_hold, v_iban, auth.uid());
  end if;

  if v_reg is not null then
    update public.registrations set status = 'cancelled' where id = v_reg and status <> 'cancelled';
  elsif v_book is not null then
    update public.training_bookings set status = 'cancelled' where id = v_book and status = 'booked';
  end if;

  perform public.money_audit(v_org, 'REFUND_REQUESTED', 'refund_requests', v_id, null,
    jsonb_build_object('family_id', q->>'family_id', 'invoice_id', q->>'invoice_id', 'registration_id', v_reg,
                       'booking_id', v_book, 'percent', q->>'percent', 'refund', q->>'refund', 'medical', v_med,
                       'preference', v_pref, 'iban', case when v_pref = 'bank_refund' then '****' || right(v_iban, 4) end));
  return jsonb_build_object('request_id', v_id, 'refund', q->>'refund', 'percent', q->>'percent', 'currency', q->>'currency');
end;
$$;

-- Finance: settle a request. Issues the credit note (once), then pays the
-- money back: family credit / bank refund (outgoing payment row) / Stripe
-- refund (returns what the server must send to Stripe; idempotency key per
-- request). An amount other than the policy amount needs an override reason.
create or replace function public.refund_request_process(
  p_request uuid, p_resolution text, p_amount numeric default null, p_override_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.refund_requests;
  v        public.invoices;
  v_exp    int;
  v_amount numeric;
  v_due    numeric;
  v_paid   numeric;
  v_credit numeric;
  v_payout numeric := 0;
  v_cn     uuid;
  v_pay    uuid;
  v_pi     record;
  v_reason text;
  v_res    jsonb;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into r from public.refund_requests where id = p_request and org_id = public.current_org_id() for update;
  if not found then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;
  if r.status not in ('requested', 'stripe_failed') then raise exception 'REQUEST_CLOSED' using errcode = 'P0001'; end if;
  if p_resolution not in ('family_credit', 'stripe_refund', 'bank_refund') then raise exception 'INVALID_RESOLUTION' using errcode = 'P0001'; end if;
  v_exp := public.currency_exponent(r.currency);
  v_amount := round(coalesce(p_amount, r.final_amount, r.computed_amount), v_exp);
  if v_amount < 0 or v_amount > r.base_amount then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  if (v_amount <> r.computed_amount and r.final_amount is null)
     or (r.medical and p_resolution <> 'family_credit' and coalesce(r.policy_snapshot->>'medical_mode', '') = 'credit') then
    if coalesce(btrim(p_override_reason), '') = '' then raise exception 'OVERRIDE_REASON_REQUIRED' using errcode = 'P0001'; end if;
  end if;
  if p_resolution = 'bank_refund' and not exists (select 1 from public.refund_bank_details where refund_request_id = r.id) then
    raise exception 'BANK_DETAILS_REQUIRED' using errcode = 'P0001';
  end if;
  v_reason := 'refund:' || r.id::text;

  -- 1. Credit note (once per request).
  if r.invoice_id is not null and r.final_amount is null then
    v := public.money_invoice_for_update(r.invoice_id);
    v_due := v.total_chf + v.adjustments_total;
    v_paid := public.invoice_net_paid(v.id);
    v_credit := least(v_amount, greatest(v_due, 0));
    if v_credit > 0 and v.status::text not in ('cancelled', 'void', 'written_off') then
      if v_credit = v_due and v_paid <= 0 and v.status::text <> 'draft' then
        perform public.cancel_invoice(v.id, v_reason);
        update public.refund_requests set invoice_cancelled = true where id = r.id;
      elsif v.status::text <> 'draft' then
        v_cn := public.money_add_adjustment(v, 'credit_note', v_credit, v_reason, null);
        perform public.recompute_invoice(v.id);
        perform public.refresh_invoice_overdue(v.id);
      end if;
    end if;
    update public.refund_requests
       set final_amount = v_amount, credit_note_id = v_cn, override_reason = nullif(btrim(coalesce(p_override_reason, '')), '')
     where id = r.id;
  elsif r.final_amount is null then
    update public.refund_requests set final_amount = v_amount,
           override_reason = nullif(btrim(coalesce(p_override_reason, '')), '') where id = r.id;
  end if;

  -- 2. Money back: the invoice's overpayment, at most the refund amount.
  if r.invoice_id is not null then
    v_due := public.invoice_amount_due(r.invoice_id);
    v_paid := public.invoice_net_paid(r.invoice_id);
    v_payout := greatest(0, least(coalesce(r.final_amount, v_amount), v_paid - greatest(v_due, 0)));
  end if;

  if v_payout <= 0 then
    update public.refund_requests
       set status = 'completed', resolution = 'none', payout_amount = 0, processed_by = auth.uid(), processed_at = now()
     where id = r.id;
    v_res := jsonb_build_object('request_id', r.id, 'status', 'completed', 'payout', 0);
  elsif p_resolution = 'family_credit' then
    v_res := public.transfer_overpayment_to_credit(r.invoice_id, v_payout, v_reason);
    update public.refund_requests
       set status = 'completed', resolution = 'family_credit', payout_amount = v_payout,
           refund_payment_id = (v_res->>'payment_id')::uuid, processed_by = auth.uid(), processed_at = now()
     where id = r.id;
    v_res := jsonb_build_object('request_id', r.id, 'status', 'completed', 'payout', v_payout);
  elsif p_resolution = 'bank_refund' then
    select * into v from public.invoices where id = r.invoice_id;
    insert into public.payments (org_id, invoice_id, amount_chf, currency, method, status, method_detail, recorded_by, paid_at, notes)
    values (v.org_id, v.id, -v_payout, v.currency, 'bank_transfer', 'succeeded', 'bank_refund', auth.uid(), now(), v_reason)
    returning id into v_pay;
    perform public.recompute_invoice(v.id);
    update public.refund_requests
       set status = 'completed', resolution = 'bank_refund', payout_amount = v_payout, refund_payment_id = v_pay,
           processed_by = auth.uid(), processed_at = now()
     where id = r.id;
    v_res := jsonb_build_object('request_id', r.id, 'status', 'completed', 'payout', v_payout);
  else
    select p.stripe_payment_intent_id as pi, p.stripe_account_id as acct,
           p.amount_chf - coalesce((select -sum(x.amount_chf) from public.payments x
                                     where x.stripe_payment_intent_id = p.stripe_payment_intent_id and x.amount_chf < 0), 0) as refundable
      into v_pi
      from public.payments p
     where p.invoice_id = r.invoice_id and p.stripe_payment_intent_id is not null and p.amount_chf > 0 and p.status = 'succeeded'
     order by p.paid_at desc nulls last
     limit 1;
    if v_pi.pi is null then raise exception 'STRIPE_NOT_AVAILABLE' using errcode = 'P0001'; end if;
    if v_pi.refundable < v_payout then raise exception 'STRIPE_AMOUNT_TOO_HIGH' using errcode = 'P0001'; end if;
    update public.refund_requests
       set status = 'processing', resolution = 'stripe_refund', payout_amount = v_payout,
           stripe_payment_intent = v_pi.pi, stripe_error = null, processed_by = auth.uid(), processed_at = now()
     where id = r.id;
    v_res := jsonb_build_object('request_id', r.id, 'status', 'processing', 'payout', v_payout,
      'stripe', jsonb_build_object('payment_intent', v_pi.pi, 'account', v_pi.acct, 'amount', v_payout,
                                   'currency', r.currency, 'idempotency_key', 'refund_' || r.id::text));
  end if;

  perform public.money_audit(r.org_id, 'REFUND_PROCESSED', 'refund_requests', r.id,
    jsonb_build_object('status', r.status, 'computed', r.computed_amount),
    jsonb_build_object('resolution', p_resolution, 'amount', coalesce(r.final_amount, v_amount), 'payout', v_payout,
                       'override_reason', nullif(btrim(coalesce(p_override_reason, '')), ''),
                       'invoice_id', r.invoice_id, 'credit_note_id', v_cn));
  return v_res;
end;
$$;

-- Service (server after calling Stripe): record the Stripe outcome.
create or replace function public.refund_request_stripe_result(p_request uuid, p_org uuid, p_refund_id text, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.refund_requests;
begin
  if not public.is_service_caller() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into r from public.refund_requests where id = p_request and org_id = p_org for update;
  if not found then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;
  if r.status = 'completed' then return jsonb_build_object('request_id', r.id, 'status', r.status, 'duplicate', true); end if;
  if r.status not in ('processing', 'stripe_failed') then raise exception 'REQUEST_CLOSED' using errcode = 'P0001'; end if;
  if p_refund_id is not null then
    update public.refund_requests set status = 'completed', stripe_refund_id = p_refund_id, stripe_error = null,
           refund_payment_id = (select id from public.payments where stripe_refund_id = p_refund_id limit 1)
     where id = r.id;
  else
    update public.refund_requests set status = 'stripe_failed', stripe_error = left(coalesce(p_error, 'error'), 300) where id = r.id;
  end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (r.org_id, null, case when p_refund_id is not null then 'REFUND_STRIPE_DONE' else 'REFUND_STRIPE_FAILED' end,
          'refund_requests', r.id, jsonb_build_object('refund_id', p_refund_id, 'error', left(coalesce(p_error, ''), 300)));
  return jsonb_build_object('request_id', r.id, 'status', case when p_refund_id is not null then 'completed' else 'stripe_failed' end);
end;
$$;

-- Finance: Stripe parameters of a request still to send (retry after a failure).
create or replace function public.refund_request_stripe_params(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.refund_requests; v_acct text;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into r from public.refund_requests where id = p_request and org_id = public.current_org_id();
  if not found then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;
  if r.status not in ('processing', 'stripe_failed') or r.stripe_payment_intent is null then
    raise exception 'REQUEST_CLOSED' using errcode = 'P0001';
  end if;
  select stripe_account_id into v_acct from public.payments where stripe_payment_intent_id = r.stripe_payment_intent limit 1;
  return jsonb_build_object('payment_intent', r.stripe_payment_intent, 'account', v_acct, 'amount', r.payout_amount,
                            'currency', r.currency, 'idempotency_key', 'refund_' || r.id::text);
end;
$$;

create or replace function public.refund_request_reject(p_request uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.refund_requests;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into r from public.refund_requests where id = p_request and org_id = public.current_org_id() for update;
  if not found then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;
  if r.status <> 'requested' then raise exception 'REQUEST_CLOSED' using errcode = 'P0001'; end if;
  update public.refund_requests
     set status = 'rejected', rejected_reason = left(btrim(p_reason), 500), processed_by = auth.uid(), processed_at = now()
   where id = r.id;
  perform public.money_audit(r.org_id, 'REFUND_REJECTED', 'refund_requests', r.id, null,
    jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('request_id', r.id, 'status', 'rejected');
end;
$$;

-- ===========================================================================
-- 5) DUNNING
-- ===========================================================================
create table if not exists public.dunning_settings (
  org_id            uuid primary key references public.organizations(id) on delete cascade,
  enabled           boolean not null default false,
  level1_days       integer not null default 10,
  level2_days       integer not null default 30,
  level2_fee        numeric(12,2) not null default 0,
  level3_days       integer not null default 50,
  level3_fee        numeric(12,2) not null default 0,
  collection_days   integer not null default 80,
  min_balance       numeric(12,2) not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint dunning_settings_chk check (
    level1_days between 1 and 365 and level2_days between 1 and 365 and level3_days between 1 and 365
    and collection_days between 1 and 730
    and level1_days < level2_days and level2_days < level3_days and level3_days < collection_days
    and level2_fee between 0 and 10000 and level3_fee between 0 and 10000 and min_balance between 0 and 100000)
);
drop trigger if exists trg_dunning_settings_updated on public.dunning_settings;
create trigger trg_dunning_settings_updated before update on public.dunning_settings
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_dunning_settings on public.dunning_settings;
create trigger trg_audit_dunning_settings after insert or update or delete on public.dunning_settings
  for each row execute function public.audit_trigger();
select public.accounting_guard_table('dunning_settings');
drop policy if exists dunning_settings_select on public.dunning_settings;
create policy dunning_settings_select on public.dunning_settings for select using (public.is_finance_of(org_id));
drop policy if exists dunning_settings_insert on public.dunning_settings;
create policy dunning_settings_insert on public.dunning_settings for insert with check (public.is_finance_of(org_id));
drop policy if exists dunning_settings_update on public.dunning_settings;
create policy dunning_settings_update on public.dunning_settings for update
  using (public.is_finance_of(org_id)) with check (public.is_finance_of(org_id));
drop policy if exists dunning_settings_delete on public.dunning_settings;
create policy dunning_settings_delete on public.dunning_settings for delete using (false);
grant select, insert, update on public.dunning_settings to authenticated;

create table if not exists public.dunning_family_pauses (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  family_id     uuid not null references public.families(id) on delete cascade,
  paused_until  date,
  reason        text not null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint dunning_family_pauses_chk check (length(btrim(reason)) between 1 and 500)
);
create index if not exists idx_dunning_family_pauses_org on public.dunning_family_pauses(org_id);
create unique index if not exists uq_dunning_family_pauses_family on public.dunning_family_pauses(family_id);

create or replace function public.dunning_pause_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.families where id = new.family_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: family' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_dunning_family_pauses_same_org on public.dunning_family_pauses;
create trigger trg_dunning_family_pauses_same_org before insert or update on public.dunning_family_pauses
  for each row execute function public.dunning_pause_same_org();
drop trigger if exists trg_dunning_family_pauses_updated on public.dunning_family_pauses;
create trigger trg_dunning_family_pauses_updated before update on public.dunning_family_pauses
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_dunning_family_pauses on public.dunning_family_pauses;
create trigger trg_audit_dunning_family_pauses after insert or update or delete on public.dunning_family_pauses
  for each row execute function public.audit_trigger();
select public.accounting_guard_table('dunning_family_pauses');
drop policy if exists dunning_family_pauses_select on public.dunning_family_pauses;
create policy dunning_family_pauses_select on public.dunning_family_pauses for select using (public.is_finance_of(org_id));
drop policy if exists dunning_family_pauses_insert on public.dunning_family_pauses;
create policy dunning_family_pauses_insert on public.dunning_family_pauses for insert with check (public.is_finance_of(org_id));
drop policy if exists dunning_family_pauses_update on public.dunning_family_pauses;
create policy dunning_family_pauses_update on public.dunning_family_pauses for update
  using (public.is_finance_of(org_id)) with check (public.is_finance_of(org_id));
drop policy if exists dunning_family_pauses_delete on public.dunning_family_pauses;
create policy dunning_family_pauses_delete on public.dunning_family_pauses for delete using (public.is_finance_of(org_id));
grant select, insert, update, delete on public.dunning_family_pauses to authenticated;

create table if not exists public.dunning_cases (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  invoice_id             uuid not null references public.invoices(id) on delete restrict,
  family_id              uuid not null references public.families(id) on delete restrict,
  level                  smallint not null default 0,
  status                 text not null default 'active',
  last_notice_at         timestamptz,
  collection_at          timestamptz,
  collection_exported_at timestamptz,
  resolved_at            timestamptz,
  resolved_reason        text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint dunning_cases_chk check (level between 0 and 4 and status in ('active', 'collection', 'resolved')
    and (resolved_reason is null or length(resolved_reason) <= 500))
);
create index if not exists idx_dunning_cases_org on public.dunning_cases(org_id, status);
create unique index if not exists uq_dunning_cases_invoice on public.dunning_cases(invoice_id);

create table if not exists public.dunning_notices (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  case_id        uuid not null references public.dunning_cases(id) on delete restrict,
  invoice_id     uuid not null references public.invoices(id) on delete restrict,
  family_id      uuid not null references public.families(id) on delete restrict,
  level          smallint not null,
  fee_amount     numeric(12,2) not null default 0,
  adjustment_id  uuid references public.invoice_adjustments(id) on delete set null,
  balance        numeric(12,2) not null,
  currency       text not null,
  ref_due_date   date not null,
  sent_at        timestamptz,
  send_attempts  integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint dunning_notices_chk check (level between 1 and 4 and fee_amount >= 0 and currency ~ '^[A-Z]{3}$')
);
create index if not exists idx_dunning_notices_org on public.dunning_notices(org_id, created_at desc);
create unique index if not exists uq_dunning_notices_level on public.dunning_notices(invoice_id, level);

do $$
declare v_t text;
begin
  foreach v_t in array array['dunning_cases', 'dunning_notices'] loop
    execute format('drop trigger if exists trg_%s_updated on public.%I', v_t, v_t);
    execute format('create trigger trg_%s_updated before update on public.%I for each row execute function public.set_updated_at()', v_t, v_t);
    execute format('drop trigger if exists trg_audit_%s on public.%I', v_t, v_t);
    execute format('create trigger trg_audit_%s after insert or update or delete on public.%I for each row execute function public.audit_trigger()', v_t, v_t);
    perform public.accounting_guard_table(v_t);
    execute format('drop policy if exists %s_select on public.%I', v_t, v_t);
    execute format('create policy %s_select on public.%I for select using (public.is_finance_of(org_id))', v_t, v_t);
    execute format('drop policy if exists %s_insert on public.%I', v_t, v_t);
    execute format('create policy %s_insert on public.%I for insert with check (false)', v_t, v_t);
    execute format('drop policy if exists %s_update on public.%I', v_t, v_t);
    execute format('create policy %s_update on public.%I for update using (false) with check (false)', v_t, v_t);
    execute format('drop policy if exists %s_delete on public.%I', v_t, v_t);
    execute format('create policy %s_delete on public.%I for delete using (false)', v_t, v_t);
    execute format('grant select on public.%I to authenticated', v_t);
  end loop;
end $$;

-- Next level to send (mirrored in src/lib/accounting/dunning.ts): one step per
-- run, the highest level whose threshold is reached; 4 = collection (only
-- after the final notice). Null = nothing to do.
create or replace function public.dunning_next_level(s public.dunning_settings, p_days int, p_level int)
returns int
language sql
immutable
as $$
  select case when v.nxt > coalesce(p_level, 0) then v.nxt end
    from (select least(coalesce(p_level, 0) + 1,
                 case when p_days >= s.collection_days and coalesce(p_level, 0) >= 3 then 4
                      when p_days >= s.level3_days then 3
                      when p_days >= s.level2_days then 2
                      when p_days >= s.level1_days then 1
                      else 0 end) as nxt) v;
$$;

-- Daily run (service role from the billing cron, or finance "run now").
-- Returns {created, collection, resolved, skipped_autopay, notices: [unsent notices to email]}.
create or replace function public.dunning_run(p_org uuid, p_today date default current_date, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s          public.dunning_settings;
  v          public.invoices;
  c          public.dunning_cases;
  v_balance  numeric;
  v_ref_due  date;
  v_plan     record;
  v_level    int;
  v_fee      numeric;
  v_adj      uuid;
  v_notice   uuid;
  v_case     uuid;
  n_created  int := 0;
  n_coll     int := 0;
  n_resolved int := 0;
  n_autopay  int := 0;
  v_preview  jsonb := '[]'::jsonb;
  v_out      jsonb;
begin
  if not (public.is_service_caller() or public.is_finance_of(p_org)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into s from public.dunning_settings where org_id = p_org;
  if not found or not s.enabled then
    return jsonb_build_object('enabled', false, 'created', 0, 'collection', 0, 'resolved', 0, 'notices', '[]'::jsonb);
  end if;

  -- Settled cases are resolved.
  if not p_dry_run then
    for c in select * from public.dunning_cases where org_id = p_org and status in ('active', 'collection') loop
      select * into v from public.invoices where id = c.invoice_id;
      if v.status::text in ('paid', 'cancelled', 'void', 'written_off', 'refunded')
         or public.invoice_amount_due(v.id) - public.invoice_net_paid(v.id) <= 0 then
        update public.dunning_cases set status = 'resolved', resolved_at = now(), resolved_reason = 'settled' where id = c.id;
        n_resolved := n_resolved + 1;
      end if;
    end loop;
  end if;

  for v in
    select i.* from public.invoices i
     where i.org_id = p_org and i.status::text in ('sent', 'partially_paid', 'overdue')
       and not coalesce(i.reminders_paused, false)
       and not exists (select 1 from public.dunning_family_pauses fp
                        where fp.family_id = i.family_id and fp.org_id = p_org
                          and (fp.paused_until is null or fp.paused_until >= p_today))
       and not exists (select 1 from public.dunning_cases dc where dc.invoice_id = i.id and dc.status in ('resolved', 'collection'))
     order by i.due_date nulls last, i.id
     for update of i skip locked
  loop
    v_balance := public.invoice_amount_due(v.id) - public.invoice_net_paid(v.id);
    continue when v_balance <= greatest(s.min_balance, 0);

    -- Instalment plan: only overdue instalments are dunned; a paused plan or
    -- an instalment that autopay still handles is skipped.
    select p.id, p.status, p.autopay into v_plan from public.payment_plans p
     where p.invoice_id = v.id and p.kind = 'installments' and p.status in ('active', 'paused')
     limit 1;
    if v_plan.id is not null then
      continue when v_plan.status = 'paused';
      select min(i.due_date), coalesce(sum(i.amount - i.amount_paid), 0) into v_ref_due, v_balance
        from public.payment_plan_installments i
       where i.plan_id = v_plan.id and i.status = 'scheduled' and i.amount_paid < i.amount and i.due_date < p_today;
      continue when v_ref_due is null or v_balance <= greatest(s.min_balance, 0);
      if exists (select 1 from public.payment_plan_installments i
                  where i.plan_id = v_plan.id and i.status = 'scheduled' and i.due_date < p_today
                    and (i.autopay_status = 'processing'
                         or (i.autopay_next_on is not null and i.autopay_status = 'failed')
                         or (v_plan.autopay and i.autopay_status is null and exists (
                               select 1 from public.autopay_mandates m
                                where m.family_id = v.family_id and m.status = 'active' and m.enabled)))) then
        n_autopay := n_autopay + 1;
        continue;
      end if;
    else
      v_ref_due := v.due_date;
      continue when v_ref_due is null or v_ref_due >= p_today;
      -- Recurring period invoices that autopay is still charging / retrying.
      if exists (select 1 from public.payment_plan_installments i
                  where i.invoice_id = v.id and i.status not in ('paid', 'cancelled', 'skipped')
                    and (i.autopay_status = 'processing' or (i.autopay_next_on is not null and i.autopay_status = 'failed'))) then
        n_autopay := n_autopay + 1;
        continue;
      end if;
    end if;

    select * into c from public.dunning_cases where invoice_id = v.id;
    v_level := public.dunning_next_level(s, p_today - v_ref_due, coalesce(c.level, 0));
    continue when v_level is null;

    if p_dry_run then
      v_preview := v_preview || jsonb_build_object('invoice_id', v.id, 'number', v.number, 'family_id', v.family_id,
        'level', v_level, 'balance', v_balance, 'currency', v.currency, 'ref_due_date', v_ref_due,
        'fee', case v_level when 2 then s.level2_fee when 3 then s.level3_fee else 0 end);
      continue;
    end if;

    if c.id is null then
      insert into public.dunning_cases (org_id, invoice_id, family_id, level, status)
      values (p_org, v.id, v.family_id, 0, 'active')
      on conflict (invoice_id) do nothing;
      select * into c from public.dunning_cases where invoice_id = v.id;
    end if;
    v_case := c.id;

    if v_level = 4 then
      update public.dunning_cases set level = 4, status = 'collection', collection_at = now() where id = v_case;
      n_coll := n_coll + 1;
      perform public.money_audit(p_org, 'DUNNING_COLLECTION', 'invoices', v.id, null,
        jsonb_build_object('balance', v_balance, 'currency', v.currency));
      continue;
    end if;

    v_notice := null;
    insert into public.dunning_notices (org_id, case_id, invoice_id, family_id, level, balance, currency, ref_due_date)
    values (p_org, v_case, v.id, v.family_id, v_level, v_balance, v.currency, v_ref_due)
    on conflict (invoice_id, level) do nothing
    returning id into v_notice;
    continue when v_notice is null;

    v_fee := round(case v_level when 2 then s.level2_fee when 3 then s.level3_fee else 0 end,
                   public.currency_exponent(v.currency));
    v_adj := null;
    if v_fee > 0 then
      v_adj := public.money_add_adjustment(v, 'debit_note', v_fee, 'dunning_fee:' || v_level, null);
      perform public.recompute_invoice(v.id);
    end if;
    update public.dunning_notices set fee_amount = v_fee, adjustment_id = v_adj, balance = v_balance + v_fee where id = v_notice;
    update public.dunning_cases set level = v_level, last_notice_at = now() where id = v_case;
    perform public.money_audit(p_org, 'DUNNING_NOTICE', 'invoices', v.id, null,
      jsonb_build_object('level', v_level, 'fee', v_fee, 'balance', v_balance + v_fee, 'currency', v.currency));
    n_created := n_created + 1;
  end loop;

  if p_dry_run then
    return jsonb_build_object('enabled', true, 'dry_run', true, 'preview', v_preview, 'skipped_autopay', n_autopay);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'notice_id', n.id, 'invoice_id', n.invoice_id, 'number', i.number, 'family_id', n.family_id,
           'level', n.level, 'fee', n.fee_amount, 'balance', n.balance, 'currency', n.currency,
           'due_date', n.ref_due_date) order by n.created_at), '[]'::jsonb)
    into v_out
    from public.dunning_notices n join public.invoices i on i.id = n.invoice_id
   where n.org_id = p_org and n.sent_at is null and n.send_attempts < 3 and n.level between 1 and 3;

  return jsonb_build_object('enabled', true, 'created', n_created, 'collection', n_coll, 'resolved', n_resolved,
                            'skipped_autopay', n_autopay, 'notices', v_out);
end;
$$;

create or replace function public.dunning_mark_sent(p_notice uuid, p_org uuid, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_service_caller() or public.is_finance_of(p_org)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  update public.dunning_notices
     set sent_at = case when p_ok then coalesce(sent_at, now()) else sent_at end,
         send_attempts = send_attempts + 1
   where id = p_notice and org_id = p_org;
end;
$$;

-- Finance: close a case by hand (agreement, paid elsewhere, sent back from collection).
create or replace function public.dunning_resolve_case(p_case uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare c public.dunning_cases;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into c from public.dunning_cases where id = p_case and org_id = public.current_org_id() for update;
  if not found then raise exception 'CASE_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.dunning_cases set status = 'resolved', resolved_at = now(), resolved_reason = left(btrim(p_reason), 500)
   where id = c.id;
  perform public.money_audit(c.org_id, 'DUNNING_RESOLVED', 'dunning_cases', c.id,
    jsonb_build_object('level', c.level, 'status', c.status), jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('case_id', c.id, 'status', 'resolved');
end;
$$;

-- Finance: mark collection cases as exported (the CSV is the hand-over).
create or replace function public.dunning_mark_exported(p_cases uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  update public.dunning_cases set collection_exported_at = now()
   where id = any(coalesce(p_cases, '{}')) and org_id = public.current_org_id() and status = 'collection';
  get diagnostics n = row_count;
  perform public.money_audit(public.current_org_id(), 'DUNNING_EXPORTED', 'dunning_cases', null, null,
    jsonb_build_object('cases', n));
  return n;
end;
$$;

-- ===========================================================================
-- 6) FAMILY SUPPORT (discount rule 'family_support') + REIMBURSEMENTS
-- ===========================================================================
alter table public.discounts
  add column if not exists scope_family_id  uuid references public.families(id) on delete cascade,
  add column if not exists max_amount       numeric(12,2),
  add column if not exists support_reason   text;
create index if not exists idx_discounts_family on public.discounts(scope_family_id) where scope_family_id is not null;

alter table public.discounts drop constraint if exists discounts_rule_chk;
alter table public.discounts add constraint discounts_rule_chk
  check (rule in ('promo_code', 'sibling', 'early_bird', 'manual', 'multi_week', 'family_support')
     and (rule <> 'promo_code' or (code is not null and code ~ '^[A-Z0-9_-]{3,40}$'))
     and (rule = 'promo_code' or code is null)
     and (rule <> 'sibling' or coalesce(sibling_min_position, 2) between 2 and 20)
     and (rule <> 'multi_week' or coalesce(multi_week_min_position, 2) between 2 and 20)
     and (rule <> 'early_bird' or valid_until is not null or early_bird_days_before is not null)
     and ((rule = 'family_support') = (scope_family_id is not null))
     and (max_amount is null or (rule = 'family_support' and max_amount > 0))
     and (support_reason is null or (rule = 'family_support'
          and support_reason in ('scholarship', 'municipal_subsidy', 'js_reduction', 'foundation', 'hardship', 'other'))));

create or replace function public.discounts_normalize()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.code := upper(nullif(btrim(new.code), ''));
  new.currency := upper(nullif(btrim(new.currency), ''));
  if new.rule = 'sibling' then new.sibling_min_position := coalesce(new.sibling_min_position, 2); end if;
  if new.rule = 'multi_week' then new.multi_week_min_position := coalesce(new.multi_week_min_position, 2);
  else new.multi_week_min_position := null; end if;
  if new.rule = 'family_support' then new.support_reason := coalesce(new.support_reason, 'other');
  else new.support_reason := null; new.max_amount := null; end if;
  if new.scope_program_id is not null
     and not exists (select 1 from public.programs where id = new.scope_program_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: program' using errcode = '42501';
  end if;
  if new.scope_service_id is not null
     and not exists (select 1 from public.training_services where id = new.scope_service_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: service' using errcode = '42501';
  end if;
  if new.scope_family_id is not null
     and not exists (select 1 from public.families where id = new.scope_family_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: family' using errcode = '42501';
  end if;
  if new.scope <> 'program' then new.scope_program_id := null; end if;
  if new.scope <> 'service' then new.scope_service_id := null; end if;
  return new;
end;
$$;

-- Finance (not only admins) manages family support; general discounts stay admin-only.
drop policy if exists discounts_family_support_insert on public.discounts;
create policy discounts_family_support_insert on public.discounts for insert
  with check (org_id = public.current_org_id() and public.is_finance() and rule = 'family_support');
drop policy if exists discounts_family_support_update on public.discounts;
create policy discounts_family_support_update on public.discounts for update
  using (org_id = public.current_org_id() and public.is_finance() and rule = 'family_support')
  with check (org_id = public.current_org_id() and public.is_finance() and rule = 'family_support');
drop policy if exists discounts_family_support_delete on public.discounts;
create policy discounts_family_support_delete on public.discounts for delete
  using (org_id = public.current_org_id() and public.is_finance() and rule = 'family_support');

alter table public.applied_discounts drop constraint if exists applied_discounts_chk;
alter table public.applied_discounts add constraint applied_discounts_chk
  check (amount > 0 and currency ~ '^[A-Z]{3}$'
     and source in ('registration', 'training_package', 'booking', 'shop', 'family_support', 'other')
     and coalesce(length(reason), 0) <= 500 and coalesce(length(void_reason), 0) <= 500);

-- A family-support discount is only ever applied through
-- family_support_apply_internal (source 'family_support', its own family).
create or replace function public.applied_discounts_family_support_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare d public.discounts;
begin
  select * into d from public.discounts where id = new.discount_id;
  if d.rule = 'family_support' and (new.source <> 'family_support' or new.family_id is distinct from d.scope_family_id) then
    raise exception 'DISCOUNT_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  if new.source = 'family_support' and d.rule <> 'family_support' then
    raise exception 'DISCOUNT_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_applied_discounts_family_support on public.applied_discounts;
create trigger trg_applied_discounts_family_support before insert on public.applied_discounts
  for each row execute function public.applied_discounts_family_support_guard();

-- Apply the family's support discounts to one issued invoice: one credit note
-- per discount (never twice), within validity, scope, currency and cap.
create or replace function public.family_support_apply_internal(p_invoice uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v        public.invoices;
  d        public.discounts;
  v_kind   text;
  v_exp    int;
  v_open   numeric;
  v_amt    numeric;
  v_used   numeric;
  v_adj    uuid;
  v_total  numeric := 0;
begin
  select * into v from public.invoices where id = p_invoice for update;
  if not found or v.status::text in ('draft', 'cancelled', 'void', 'written_off', 'refunded') then return 0; end if;
  v_kind := public.accounting_invoice_kind(v.id);
  v_exp := public.currency_exponent(v.currency);
  for d in
    select * from public.discounts x
     where x.org_id = v.org_id and x.rule = 'family_support' and x.is_active and x.scope_family_id = v.family_id
       and (x.valid_from is null or x.valid_from <= v.issued_at) and (x.valid_until is null or x.valid_until >= v.issued_at)
       and (x.kind = 'percent' or x.currency = v.currency)
       and (x.scope = 'all'
            or (x.scope = 'camps' and v_kind = 'camp')
            or (x.scope = 'training' and v_kind = 'training')
            or (x.scope = 'shop' and v_kind = 'shop')
            or (x.scope = 'program' and x.scope_program_id = v.program_id))
       and not exists (select 1 from public.applied_discounts a
                        where a.discount_id = x.id and a.invoice_id = v.id and a.voided_at is null)
     order by x.created_at, x.id
  loop
    select total_chf + adjustments_total - public.invoice_net_paid(id) into v_open from public.invoices where id = v.id;
    exit when v_open <= 0;
    v_amt := case when d.kind = 'percent' then round(v.total_chf * least(d.value, 100) / 100, v_exp)
                  else round(d.value, v_exp) end;
    if d.max_amount is not null then
      select coalesce(sum(amount), 0) into v_used from public.applied_discounts where discount_id = d.id and voided_at is null;
      v_amt := least(v_amt, d.max_amount - v_used);
    end if;
    v_amt := least(v_amt, v_open);
    continue when v_amt <= 0;
    select * into v from public.invoices where id = v.id;
    v_adj := public.money_add_adjustment(v, 'credit_note', v_amt, 'family_support:' || coalesce(d.support_reason, 'other'), d.name);
    insert into public.applied_discounts (org_id, discount_id, invoice_id, invoice_adjustment_id, source, source_id,
                                          family_id, rule, name, kind, value, amount, currency, reason)
    values (v.org_id, d.id, v.id, v_adj, 'family_support', v.id, v.family_id, d.rule, d.name, d.kind, d.value,
            v_amt, v.currency, d.support_reason);
    v_total := v_total + v_amt;
  end loop;
  if v_total > 0 then
    perform public.recompute_invoice(v.id);
    perform public.money_audit(v.org_id, 'FAMILY_SUPPORT_APPLIED', 'invoices', v.id, null,
      jsonb_build_object('amount', v_total, 'currency', v.currency));
  end if;
  return v_total;
end;
$$;

create or replace function public.family_support_apply(p_invoice uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v public.invoices; v_amt numeric;
begin
  v := public.money_invoice_for_update(p_invoice);
  v_amt := public.family_support_apply_internal(v.id);
  return jsonb_build_object('invoice_id', v.id, 'amount', v_amt);
end;
$$;

-- Service (billing cron) or finance: apply support to every open invoice of
-- families with an active support discount.
create or replace function public.family_support_sweep(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r record; n int := 0; v_sum numeric := 0; v_amt numeric;
begin
  if not (public.is_service_caller() or public.is_finance_of(p_org)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  for r in
    select i.id from public.invoices i
     where i.org_id = p_org and i.status::text in ('sent', 'partially_paid', 'overdue')
       and exists (select 1 from public.discounts d where d.org_id = p_org and d.rule = 'family_support'
                     and d.is_active and d.scope_family_id = i.family_id)
     order by i.issued_at
  loop
    v_amt := public.family_support_apply_internal(r.id);
    if v_amt > 0 then n := n + 1; v_sum := v_sum + v_amt; end if;
  end loop;
  return jsonb_build_object('invoices', n, 'amount', v_sum);
end;
$$;

create table if not exists public.external_reimbursements (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  funder_kind      text not null,
  funder_name      text not null,
  family_id        uuid references public.families(id) on delete set null,
  invoice_id       uuid references public.invoices(id) on delete set null,
  period_start     date,
  period_end       date,
  amount_expected  numeric(12,2) not null,
  amount_received  numeric(12,2),
  currency         text not null,
  status           text not null default 'expected',
  requested_on     date,
  received_on      date,
  reference        text,
  notes            text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint external_reimbursements_chk check (
    funder_kind in ('city', 'canton', 'foundation', 'js', 'other')
    and length(btrim(funder_name)) between 1 and 140
    and amount_expected > 0 and (amount_received is null or amount_received >= 0)
    and currency ~ '^[A-Z]{3}$'
    and status in ('expected', 'requested', 'received', 'rejected')
    and (period_start is null or period_end is null or period_end >= period_start)
    and (status <> 'received' or (received_on is not null and amount_received is not null))
    and (reference is null or length(reference) <= 140) and (notes is null or length(notes) <= 1000))
);
create index if not exists idx_external_reimbursements_org on public.external_reimbursements(org_id, status);

create or replace function public.external_reimbursements_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.family_id is not null and not exists (select 1 from public.families where id = new.family_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: family' using errcode = '42501';
  end if;
  if new.invoice_id is not null and not exists (select 1 from public.invoices where id = new.invoice_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: invoice' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_external_reimbursements_same_org on public.external_reimbursements;
create trigger trg_external_reimbursements_same_org before insert or update on public.external_reimbursements
  for each row execute function public.external_reimbursements_same_org();
drop trigger if exists trg_external_reimbursements_updated on public.external_reimbursements;
create trigger trg_external_reimbursements_updated before update on public.external_reimbursements
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_external_reimbursements on public.external_reimbursements;
create trigger trg_audit_external_reimbursements after insert or update or delete on public.external_reimbursements
  for each row execute function public.audit_trigger();
select public.accounting_guard_table('external_reimbursements');
drop policy if exists external_reimbursements_select on public.external_reimbursements;
create policy external_reimbursements_select on public.external_reimbursements for select using (public.is_finance_of(org_id));
drop policy if exists external_reimbursements_insert on public.external_reimbursements;
create policy external_reimbursements_insert on public.external_reimbursements for insert with check (public.is_finance_of(org_id));
drop policy if exists external_reimbursements_update on public.external_reimbursements;
create policy external_reimbursements_update on public.external_reimbursements for update
  using (public.is_finance_of(org_id)) with check (public.is_finance_of(org_id));
drop policy if exists external_reimbursements_delete on public.external_reimbursements;
create policy external_reimbursements_delete on public.external_reimbursements for delete
  using (public.is_finance_of(org_id) and status in ('expected', 'rejected'));
grant select, insert, update, delete on public.external_reimbursements to authenticated;

-- ===========================================================================
-- 7) EXECUTE grants
-- ===========================================================================
do $$
declare f text;
begin
  -- Signed-in users (each function checks role + org itself).
  foreach f in array array[
    'public.accounting_close_period(date)',
    'public.accounting_reopen_period(date, text)',
    'public.accounting_seed_chart(jsonb, jsonb)',
    'public.accounting_journal_source(date, date)',
    'public.accounting_open_items(date)',
    'public.bank_import(jsonb, jsonb, boolean)',
    'public.bank_entry_confirm(uuid, uuid)',
    'public.bank_entry_ignore(uuid, text)',
    'public.bank_entry_reopen(uuid, text)',
    'public.refund_quote(uuid, uuid, uuid, boolean, date)',
    'public.refund_request_create(jsonb)',
    'public.refund_request_process(uuid, text, numeric, text)',
    'public.refund_request_stripe_params(uuid)',
    'public.refund_request_reject(uuid, text)',
    'public.dunning_run(uuid, date, boolean)',
    'public.dunning_mark_sent(uuid, uuid, boolean)',
    'public.dunning_resolve_case(uuid, text)',
    'public.dunning_mark_exported(uuid[])',
    'public.family_support_apply(uuid)',
    'public.family_support_sweep(uuid)',
    'public.iban_is_valid(text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;

  -- Internal / service only.
  foreach f in array array[
    'public.accounting_period_closed(uuid, date)',
    'public.accounting_invoice_kind(uuid)',
    'public.bank_invoice_payable(uuid, uuid, text)',
    'public.bank_entry_book_internal(uuid, uuid, text)',
    'public.refund_subject(uuid, uuid, uuid)',
    'public.refund_policy_percent(public.refund_policies, int, boolean)',
    'public.refund_request_stripe_result(uuid, uuid, text, text)',
    'public.dunning_next_level(public.dunning_settings, int, int)',
    'public.family_support_apply_internal(uuid)',
    'public.accounting_guard_table(text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
