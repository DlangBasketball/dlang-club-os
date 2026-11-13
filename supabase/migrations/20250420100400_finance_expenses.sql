-- ============================================================================
-- Finance: expenses, expense categories / suppliers, receipts, coach pay
-- rates and monthly coach payouts. Additive and idempotent.
--
--  1) public.expense_categories / public.expense_suppliers: editable lists per
--     org (admin + finance). A list entry that is used by an expense cannot be
--     deleted (FK restrict); the app deactivates it instead.
--  2) public.expenses: one row per expense (date, amount, currency, category,
--     supplier, optional coach / programme / camp edition / team / venue link,
--     description, payment method, paid / unpaid, receipt in the private
--     "expense-receipts" bucket, monthly recurrence). Expenses are never hard
--     deleted by users: delete = soft delete (deleted_at, deleted_by,
--     delete_reason), recorded in audit_logs by the audit trigger.
--  3) generate_recurring_expenses(): posts the monthly copies of recurring
--     expenses up to a date (idempotent; one copy per template and month).
--  4) public.coach_pay_rates: per coach an hourly or per-session rate.
--  5) public.coach_payouts: a paid monthly payout per coach. Recorded through
--     record_coach_payout(), which also creates the matching expense (one
--     transaction). void_coach_payout() reverses it (soft-deletes the expense).
--  6) Storage bucket "expense-receipts" (private). Keys:
--     <org_id>/<expense_id>/<file>. Admin + finance of that org only.
--
-- Access: admin and finance of the row's org (is_finance() = admin or
-- finance). A coach reads their own pay rate and payouts. Guardians and other
-- orgs see nothing. Every table: org_id, RLS, one policy per verb, audit
-- trigger, same-org guard on every foreign key.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Same-org guard for the finance tables
-- ---------------------------------------------------------------------------
create or replace function public.finance_same_org_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_org uuid  := (v_row->>'org_id')::uuid;
  v_col text;
  v_id  uuid;
  v_tab text;
  v_ok  boolean;
begin
  foreach v_col in array tg_argv loop
    v_id := nullif(v_row->>v_col, '')::uuid;
    continue when v_id is null;
    v_tab := case v_col
      when 'category_id'          then 'expense_categories'
      when 'supplier_id'          then 'expense_suppliers'
      when 'coach_id'             then 'coaches'
      when 'program_id'           then 'programs'
      when 'camp_edition_id'      then 'camp_editions'
      when 'team_id'              then 'teams'
      when 'venue_id'             then 'venues'
      when 'recurrence_parent_id' then 'expenses'
      when 'expense_id'           then 'expenses'
      when 'coach_payout_id'      then 'coach_payouts'
    end;
    if v_tab is null then raise exception 'finance_same_org_guard: unknown column %', v_col; end if;
    execute format('select exists (select 1 from public.%I where id = $1 and org_id = $2)', v_tab)
      into v_ok using v_id, v_org;
    if not v_ok then
      raise exception 'CROSS_ORG_REFERENCE: %', v_col using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Categories and suppliers
-- ---------------------------------------------------------------------------
create table if not exists public.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  is_active   boolean not null default true,
  sort        integer not null default 0,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_expense_categories_org on public.expense_categories(org_id);
create unique index if not exists uq_expense_categories_name on public.expense_categories(org_id, lower(btrim(name)));

create table if not exists public.expense_suppliers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  contact     text check (contact is null or char_length(contact) <= 200),
  notes       text check (notes is null or char_length(notes) <= 1000),
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_expense_suppliers_org on public.expense_suppliers(org_id);
create unique index if not exists uq_expense_suppliers_name on public.expense_suppliers(org_id, lower(btrim(name)));

do $$
declare v_t text;
begin
  foreach v_t in array array['expense_categories', 'expense_suppliers'] loop
    execute format('drop trigger if exists trg_%s_updated on public.%I', v_t, v_t);
    execute format('create trigger trg_%s_updated before update on public.%I for each row execute function public.set_updated_at()', v_t, v_t);
    execute format('drop trigger if exists trg_audit_%s on public.%I', v_t, v_t);
    execute format('create trigger trg_audit_%s after insert or update or delete on public.%I for each row execute function public.audit_trigger()', v_t, v_t);
    execute format('alter table public.%I enable row level security', v_t);
    execute format('drop policy if exists %s_select on public.%I', v_t, v_t);
    execute format('create policy %s_select on public.%I for select using (org_id = public.current_org_id() and public.is_finance())', v_t, v_t);
    execute format('drop policy if exists %s_insert on public.%I', v_t, v_t);
    execute format('create policy %s_insert on public.%I for insert with check (org_id = public.current_org_id() and public.is_finance())', v_t, v_t);
    execute format('drop policy if exists %s_update on public.%I', v_t, v_t);
    execute format('create policy %s_update on public.%I for update using (org_id = public.current_org_id() and public.is_finance()) with check (org_id = public.current_org_id() and public.is_finance())', v_t, v_t);
    execute format('drop policy if exists %s_delete on public.%I', v_t, v_t);
    execute format('create policy %s_delete on public.%I for delete using (org_id = public.current_org_id() and public.is_finance())', v_t, v_t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', v_t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Expenses
-- ---------------------------------------------------------------------------
create table if not exists public.expenses (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  expense_date         date not null,
  amount               numeric(12,2) not null check (amount > 0 and amount <= 10000000),
  currency             text not null check (currency ~ '^[A-Z]{3}$'),
  category_id          uuid references public.expense_categories(id) on delete restrict,
  supplier_id          uuid references public.expense_suppliers(id) on delete restrict,
  coach_id             uuid references public.coaches(id) on delete set null,
  program_id           uuid references public.programs(id) on delete set null,
  camp_edition_id      uuid references public.camp_editions(id) on delete set null,
  team_id              uuid references public.teams(id) on delete set null,
  venue_id             uuid references public.venues(id) on delete set null,
  description          text check (description is null or char_length(description) <= 1000),
  payment_method       text not null default 'bank_transfer'
                         check (payment_method in ('bank_transfer', 'card', 'cash', 'twint', 'direct_debit', 'other')),
  status               text not null default 'unpaid' check (status in ('paid', 'unpaid')),
  paid_on              date,
  receipt_path         text,
  receipt_name         text check (receipt_name is null or char_length(receipt_name) <= 200),
  receipt_type         text check (receipt_type is null or receipt_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  recurring_monthly    boolean not null default false,
  recurrence_parent_id uuid references public.expenses(id) on delete set null,
  coach_payout_id      uuid,
  deleted_at           timestamptz,
  deleted_by           uuid references public.profiles(id) on delete set null,
  delete_reason        text check (delete_reason is null or char_length(delete_reason) <= 500),
  created_by           uuid references public.profiles(id) on delete set null,
  updated_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint expenses_receipt_scope check (receipt_path is null or receipt_path like (org_id::text || '/' || id::text || '/%')),
  constraint expenses_paid_on_chk check (status = 'paid' or paid_on is null),
  constraint expenses_recurrence_chk check (recurrence_parent_id is null or not recurring_monthly),
  constraint expenses_deleted_chk check (deleted_at is not null or (deleted_by is null and delete_reason is null))
);
create index if not exists idx_expenses_org        on public.expenses(org_id);
create index if not exists idx_expenses_org_date   on public.expenses(org_id, expense_date desc) where deleted_at is null;
create index if not exists idx_expenses_category   on public.expenses(category_id);
create index if not exists idx_expenses_supplier   on public.expenses(supplier_id);
create index if not exists idx_expenses_coach      on public.expenses(coach_id) where coach_id is not null;
create index if not exists idx_expenses_program    on public.expenses(program_id) where program_id is not null;
create unique index if not exists uq_expenses_recurrence on public.expenses(recurrence_parent_id, expense_date)
  where recurrence_parent_id is not null;

drop trigger if exists trg_expenses_updated on public.expenses;
create trigger trg_expenses_updated before update on public.expenses
  for each row execute function public.set_updated_at();
drop trigger if exists trg_expenses_same_org on public.expenses;
create trigger trg_expenses_same_org before insert or update on public.expenses
  for each row execute function public.finance_same_org_guard(
    'category_id', 'supplier_id', 'coach_id', 'program_id', 'camp_edition_id', 'team_id', 'venue_id', 'recurrence_parent_id');
drop trigger if exists trg_audit_expenses on public.expenses;
create trigger trg_audit_expenses after insert or update or delete on public.expenses
  for each row execute function public.audit_trigger();

alter table public.expenses enable row level security;
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select
  using (org_id = public.current_org_id() and public.is_finance());
drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert
  with check (org_id = public.current_org_id() and public.is_finance() and deleted_at is null);
-- A soft-deleted expense is frozen: only live rows can be updated (which is
-- also how a row gets soft-deleted).
drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update
  using (org_id = public.current_org_id() and public.is_finance() and deleted_at is null)
  with check (org_id = public.current_org_id() and public.is_finance());
-- No hard delete from the API: delete = soft delete (kept for the audit trail
-- and the accounting record). Retention jobs use the service role.
drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete on public.expenses for delete using (false);
grant select, insert, update, delete on public.expenses to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Recurring monthly expenses
-- ---------------------------------------------------------------------------
-- For every live template (recurring_monthly) of the caller's org, insert one
-- unpaid copy per month after the template's month, up to p_until (never in
-- the future). The day of month is kept, clamped to the month's last day.
-- Idempotent (unique template + date); a copy that was soft-deleted is not
-- posted again. Returns the number of copies created.
create or replace function public.generate_recurring_expenses(p_until date default null)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_until date := least(coalesce(p_until, current_date), current_date);
  v_tpl   public.expenses%rowtype;
  v_n     integer := 0;
  v_i     integer;
  v_month date;
  v_day   date;
  v_rows  integer;
begin
  if auth.uid() is null or v_org is null or not public.is_finance() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  for v_tpl in
    select * from public.expenses e
     where e.org_id = v_org and e.recurring_monthly and e.deleted_at is null
       and e.recurrence_parent_id is null and e.expense_date < v_until
  loop
    for v_i in 1..36 loop
      v_month := (date_trunc('month', v_tpl.expense_date) + make_interval(months => v_i))::date;
      exit when v_month > v_until;
      v_day := least(v_month + (extract(day from v_tpl.expense_date)::int - 1),
                     (v_month + interval '1 month' - interval '1 day')::date);
      exit when v_day > v_until;
      insert into public.expenses (org_id, expense_date, amount, currency, category_id, supplier_id, coach_id,
                                   program_id, camp_edition_id, team_id, venue_id, description, payment_method,
                                   status, recurring_monthly, recurrence_parent_id, created_by, updated_by)
      values (v_org, v_day, v_tpl.amount, v_tpl.currency, v_tpl.category_id, v_tpl.supplier_id, v_tpl.coach_id,
              v_tpl.program_id, v_tpl.camp_edition_id, v_tpl.team_id, v_tpl.venue_id, v_tpl.description,
              v_tpl.payment_method, 'unpaid', false, v_tpl.id, auth.uid(), auth.uid())
      on conflict (recurrence_parent_id, expense_date) where recurrence_parent_id is not null do nothing;
      get diagnostics v_rows = row_count;
      v_n := v_n + v_rows;
    end loop;
  end loop;
  if v_n > 0 then
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
    values (v_org, auth.uid(), 'expense.recurring.generate', 'expenses', null,
            jsonb_build_object('created', v_n, 'until', v_until));
  end if;
  return v_n;
end;
$$;
revoke all on function public.generate_recurring_expenses(date) from public, anon;
grant execute on function public.generate_recurring_expenses(date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Coach pay rates
-- ---------------------------------------------------------------------------
create table if not exists public.coach_pay_rates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  coach_id    uuid not null references public.coaches(id) on delete cascade,
  rate_type   text not null check (rate_type in ('hourly', 'per_session')),
  amount      numeric(12,2) not null check (amount >= 0 and amount <= 100000),
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  notes       text check (notes is null or char_length(notes) <= 500),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (coach_id)
);
create index if not exists idx_coach_pay_rates_org on public.coach_pay_rates(org_id);

drop trigger if exists trg_coach_pay_rates_updated on public.coach_pay_rates;
create trigger trg_coach_pay_rates_updated before update on public.coach_pay_rates
  for each row execute function public.set_updated_at();
drop trigger if exists trg_coach_pay_rates_same_org on public.coach_pay_rates;
create trigger trg_coach_pay_rates_same_org before insert or update on public.coach_pay_rates
  for each row execute function public.finance_same_org_guard('coach_id');
drop trigger if exists trg_audit_coach_pay_rates on public.coach_pay_rates;
create trigger trg_audit_coach_pay_rates after insert or update or delete on public.coach_pay_rates
  for each row execute function public.audit_trigger();

alter table public.coach_pay_rates enable row level security;
drop policy if exists coach_pay_rates_select on public.coach_pay_rates;
create policy coach_pay_rates_select on public.coach_pay_rates for select
  using (org_id = public.current_org_id() and (public.is_finance() or coach_id = public.current_coach_id()));
drop policy if exists coach_pay_rates_insert on public.coach_pay_rates;
create policy coach_pay_rates_insert on public.coach_pay_rates for insert
  with check (org_id = public.current_org_id() and public.is_finance());
drop policy if exists coach_pay_rates_update on public.coach_pay_rates;
create policy coach_pay_rates_update on public.coach_pay_rates for update
  using (org_id = public.current_org_id() and public.is_finance())
  with check (org_id = public.current_org_id() and public.is_finance());
drop policy if exists coach_pay_rates_delete on public.coach_pay_rates;
create policy coach_pay_rates_delete on public.coach_pay_rates for delete
  using (org_id = public.current_org_id() and public.is_finance());
grant select, insert, update, delete on public.coach_pay_rates to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Coach payouts
-- ---------------------------------------------------------------------------
create table if not exists public.coach_payouts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  coach_id       uuid not null references public.coaches(id) on delete restrict,
  period_month   date not null check (extract(day from period_month) = 1),
  sessions       integer not null default 0 check (sessions >= 0),
  bookings       integer not null default 0 check (bookings >= 0),
  minutes        integer not null default 0 check (minutes >= 0),
  clock_minutes  integer check (clock_minutes is null or clock_minutes >= 0),
  rate_type      text not null check (rate_type in ('hourly', 'per_session')),
  rate_amount    numeric(12,2) not null check (rate_amount >= 0),
  amount         numeric(12,2) not null check (amount > 0),
  currency       text not null check (currency ~ '^[A-Z]{3}$'),
  status         text not null default 'paid' check (status in ('paid', 'void')),
  paid_on        date not null,
  expense_id     uuid references public.expenses(id) on delete set null,
  breakdown      jsonb,
  void_reason    text check (void_reason is null or char_length(void_reason) <= 500),
  voided_at      timestamptz,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_coach_payouts_org on public.coach_payouts(org_id, period_month);
create unique index if not exists uq_coach_payouts_paid on public.coach_payouts(coach_id, period_month) where status = 'paid';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_coach_payout_fk') then
    alter table public.expenses add constraint expenses_coach_payout_fk
      foreign key (coach_payout_id) references public.coach_payouts(id) on delete set null;
  end if;
end $$;
create index if not exists idx_expenses_payout on public.expenses(coach_payout_id) where coach_payout_id is not null;

drop trigger if exists trg_coach_payouts_updated on public.coach_payouts;
create trigger trg_coach_payouts_updated before update on public.coach_payouts
  for each row execute function public.set_updated_at();
drop trigger if exists trg_coach_payouts_same_org on public.coach_payouts;
create trigger trg_coach_payouts_same_org before insert or update on public.coach_payouts
  for each row execute function public.finance_same_org_guard('coach_id', 'expense_id');
drop trigger if exists trg_audit_coach_payouts on public.coach_payouts;
create trigger trg_audit_coach_payouts after insert or update or delete on public.coach_payouts
  for each row execute function public.audit_trigger();

-- expenses.coach_payout_id must stay inside the org as well.
drop trigger if exists trg_expenses_payout_same_org on public.expenses;
create trigger trg_expenses_payout_same_org before insert or update of coach_payout_id on public.expenses
  for each row execute function public.finance_same_org_guard('coach_payout_id');

alter table public.coach_payouts enable row level security;
drop policy if exists coach_payouts_select on public.coach_payouts;
create policy coach_payouts_select on public.coach_payouts for select
  using (org_id = public.current_org_id() and (public.is_finance() or coach_id = public.current_coach_id()));
drop policy if exists coach_payouts_insert on public.coach_payouts;
create policy coach_payouts_insert on public.coach_payouts for insert
  with check (org_id = public.current_org_id() and public.is_finance());
drop policy if exists coach_payouts_update on public.coach_payouts;
create policy coach_payouts_update on public.coach_payouts for update
  using (org_id = public.current_org_id() and public.is_finance())
  with check (org_id = public.current_org_id() and public.is_finance());
drop policy if exists coach_payouts_delete on public.coach_payouts;
create policy coach_payouts_delete on public.coach_payouts for delete using (false);
grant select, insert, update, delete on public.coach_payouts to authenticated;

-- record_coach_payout: marks a coach's month as paid and books the matching
-- expense (category p_category_name, created when missing) in one
-- transaction. The amount is computed by the app from attendance / bookings
-- (and clock-in hours when the staff module provides them) and is shown to
-- the finance user before they confirm.
create or replace function public.record_coach_payout(
  p_coach         uuid,
  p_month         date,
  p_amount        numeric,
  p_currency      text,
  p_rate_type     text,
  p_rate_amount   numeric,
  p_sessions      integer,
  p_bookings      integer,
  p_minutes       integer,
  p_clock_minutes integer,
  p_breakdown     jsonb,
  p_paid_on       date,
  p_method        text,
  p_category_name text,
  p_description   text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org      uuid := public.current_org_id();
  v_month    date := date_trunc('month', p_month)::date;
  v_amount   numeric(12,2) := round(coalesce(p_amount, 0), 2);
  v_cur      text := upper(btrim(coalesce(p_currency, '')));
  v_cat      uuid;
  v_expense  uuid;
  v_payout   uuid;
begin
  if auth.uid() is null or v_org is null or not public.is_finance() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.coaches c where c.id = p_coach and c.org_id = v_org) then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY' using errcode = 'P0001'; end if;
  if p_rate_type not in ('hourly', 'per_session') then raise exception 'INVALID_RATE' using errcode = 'P0001'; end if;
  if p_method not in ('bank_transfer', 'card', 'cash', 'twint', 'direct_debit', 'other') then
    raise exception 'INVALID_METHOD' using errcode = 'P0001';
  end if;
  if v_month > date_trunc('month', current_date)::date then raise exception 'FUTURE_MONTH' using errcode = 'P0001'; end if;
  if exists (select 1 from public.coach_payouts p where p.coach_id = p_coach and p.period_month = v_month and p.status = 'paid') then
    raise exception 'ALREADY_PAID' using errcode = 'P0001';
  end if;

  select id into v_cat from public.expense_categories
   where org_id = v_org and lower(btrim(name)) = lower(btrim(coalesce(p_category_name, '')));
  if v_cat is null and char_length(btrim(coalesce(p_category_name, ''))) between 1 and 80 then
    insert into public.expense_categories (org_id, name, created_by)
    values (v_org, btrim(p_category_name), auth.uid()) returning id into v_cat;
  end if;

  insert into public.expenses (org_id, expense_date, amount, currency, category_id, coach_id, description,
                               payment_method, status, paid_on, created_by, updated_by)
  values (v_org, coalesce(p_paid_on, current_date), v_amount, v_cur, v_cat, p_coach, left(p_description, 1000),
          p_method, 'paid', coalesce(p_paid_on, current_date), auth.uid(), auth.uid())
  returning id into v_expense;

  insert into public.coach_payouts (org_id, coach_id, period_month, sessions, bookings, minutes, clock_minutes,
                                    rate_type, rate_amount, amount, currency, status, paid_on, expense_id,
                                    breakdown, created_by)
  values (v_org, p_coach, v_month, greatest(coalesce(p_sessions, 0), 0), greatest(coalesce(p_bookings, 0), 0),
          greatest(coalesce(p_minutes, 0), 0), p_clock_minutes, p_rate_type, round(coalesce(p_rate_amount, 0), 2),
          v_amount, v_cur, 'paid', coalesce(p_paid_on, current_date), v_expense, p_breakdown, auth.uid())
  returning id into v_payout;

  update public.expenses set coach_payout_id = v_payout where id = v_expense;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'coach_payout.paid', 'coach_payouts', v_payout,
          jsonb_build_object('coach_id', p_coach, 'month', v_month, 'amount', v_amount, 'currency', v_cur, 'expense_id', v_expense));

  return jsonb_build_object('payout_id', v_payout, 'expense_id', v_expense);
end;
$$;
revoke all on function public.record_coach_payout(uuid, date, numeric, text, text, numeric, integer, integer, integer, integer, jsonb, date, text, text, text) from public, anon;
grant execute on function public.record_coach_payout(uuid, date, numeric, text, text, numeric, integer, integer, integer, integer, jsonb, date, text, text, text) to authenticated, service_role;

-- void_coach_payout: undo a payout recorded by mistake. The payout row stays
-- (status void) and its expense is soft-deleted, both with the reason.
create or replace function public.void_coach_payout(p_payout uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_row public.coach_payouts%rowtype;
begin
  if auth.uid() is null or v_org is null or not public.is_finance() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into v_row from public.coach_payouts where id = p_payout and org_id = v_org for update;
  if not found then raise exception 'PAYOUT_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_row.status = 'void' then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  update public.coach_payouts
     set status = 'void', voided_at = now(), void_reason = left(btrim(p_reason), 500)
   where id = v_row.id;
  if v_row.expense_id is not null then
    update public.expenses
       set deleted_at = now(), deleted_by = auth.uid(), delete_reason = left(btrim(p_reason), 500), updated_by = auth.uid()
     where id = v_row.expense_id and org_id = v_org and deleted_at is null;
  end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'coach_payout.void', 'coach_payouts', v_row.id,
          jsonb_build_object('reason', left(btrim(p_reason), 500), 'expense_id', v_row.expense_id));
end;
$$;
revoke all on function public.void_coach_payout(uuid, text) from public, anon;
grant execute on function public.void_coach_payout(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Storage: private receipts bucket
-- ---------------------------------------------------------------------------
-- Key format: <org_id>/<expense_id>/<file>. The org segment must be the
-- caller's org, the expense must belong to it, and the caller must be admin
-- or finance. Writes also require a live (not soft-deleted) expense.
create or replace function public.expense_receipt_access(p_name text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts text[];
  v_org   uuid;
  v_exp   uuid;
  v_re    constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if auth.uid() is null or p_name is null then return false; end if;
  if not public.is_finance() then return false; end if;
  v_parts := string_to_array(p_name, '/');
  if coalesce(array_length(v_parts, 1), 0) <> 3 or v_parts[3] = '' then return false; end if;
  if v_parts[1] !~ v_re or v_parts[2] !~ v_re then return false; end if;
  v_org := v_parts[1]::uuid;
  v_exp := v_parts[2]::uuid;
  if v_org is distinct from public.current_org_id() then return false; end if;
  return exists (select 1 from public.expenses e
                  where e.id = v_exp and e.org_id = v_org
                    and (not p_write or e.deleted_at is null));
end $$;
revoke all on function public.expense_receipt_access(text, boolean) from public, anon;
grant execute on function public.expense_receipt_access(text, boolean) to authenticated, service_role;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
      values ('expense-receipts', 'expense-receipts', false)
      on conflict (id) do update set public = false;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      execute $q$update storage.buckets set file_size_limit = 10485760 where id = 'expense-receipts'$q$;
    end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
      execute $q$update storage.buckets set allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp']
                 where id = 'expense-receipts'$q$;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute $p$drop policy if exists expense_receipts_select on storage.objects$p$;
    execute $p$create policy expense_receipts_select on storage.objects for select to authenticated
      using (bucket_id = 'expense-receipts' and public.expense_receipt_access(name, false))$p$;
    execute $p$drop policy if exists expense_receipts_insert on storage.objects$p$;
    execute $p$create policy expense_receipts_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'expense-receipts' and public.expense_receipt_access(name, true))$p$;
    execute $p$drop policy if exists expense_receipts_update on storage.objects$p$;
    execute $p$create policy expense_receipts_update on storage.objects for update to authenticated
      using (bucket_id = 'expense-receipts' and public.expense_receipt_access(name, true))
      with check (bucket_id = 'expense-receipts' and public.expense_receipt_access(name, true))$p$;
    execute $p$drop policy if exists expense_receipts_delete on storage.objects$p$;
    execute $p$create policy expense_receipts_delete on storage.objects for delete to authenticated
      using (bucket_id = 'expense-receipts' and public.expense_receipt_access(name, true))$p$;
  end if;
end $$;
