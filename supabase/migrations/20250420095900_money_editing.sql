-- ============================================================================
-- Money editing: invoices, payments and credits stay correct in real time.
-- Additive and idempotent.
--
-- Accounting rules this migration enforces (founder request, track C):
--   * A DRAFT invoice was never issued: finance edits it freely (lines,
--     quantities, prices, discount, tax, due date, recipient family, notes,
--     language). The QR / RF payment reference never changes.
--   * An ISSUED invoice keeps its original amount. Safe fields (due date,
--     notes, language, reminder pause) are editable; amount changes are made
--     with an adjustment document (credit note / debit note / write-off /
--     cancellation) in public.invoice_adjustments. The amount still due is
--     total_chf + adjustments_total (a denormalised, trigger-free sum kept by
--     the RPCs below). The payment reference stays stable, so a QR-bill that
--     was already printed still reconciles; a new PDF carries the new amount.
--   * Payments stay append-only. A manual payment is voided with a reason by
--     appending a reversing row (negative amount, reverses_payment_id) and
--     flagging the original (voided_at). Editing / re-allocating = void +
--     a new row (replaced_by_payment_id). Stripe-originated rows are never
--     voided or edited here (refunds go through Stripe); only annotated.
--   * Overpayments: net paid > amount due is flagged; finance moves the
--     excess to a per-family money credit (public.family_credit_entries, an
--     append-only ledger) and can apply that credit to another invoice.
--   * Training-credit grants get an append-only ledger with reasons
--     (public.training_credit_adjustments); adjust / revoke never go below
--     the credits already used.
--   * Every RPC: SECURITY DEFINER, search_path pinned, admin/finance of the
--     caller's org only (is_finance() is org-scoped; the target row must be in
--     current_org_id()), amounts rounded to the currency's minor unit, and an
--     audit_logs row with before/after amounts.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Enum value: written_off. Only used inside function bodies in this file
--    (a new enum value cannot be used in the transaction that adds it).
-- ---------------------------------------------------------------------------
alter type public.invoice_status add value if not exists 'written_off';

-- ---------------------------------------------------------------------------
-- 1) Columns
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column if not exists adjustments_total numeric(12,2) not null default 0,
  add column if not exists notes             text,
  add column if not exists locale            text,
  add column if not exists reminders_paused  boolean not null default false,
  add column if not exists cancelled_at      timestamptz,
  add column if not exists cancel_reason     text,
  add column if not exists written_off_at    timestamptz;

alter table public.invoices drop constraint if exists invoices_locale_known;
alter table public.invoices add constraint invoices_locale_known
  check (locale is null or locale in ('en', 'de', 'fr', 'it', 'es'));

alter table public.payments
  add column if not exists voided_at              timestamptz,
  add column if not exists voided_by              uuid references public.profiles(id) on delete set null,
  add column if not exists void_reason            text,
  add column if not exists reverses_payment_id    uuid references public.payments(id) on delete restrict,
  add column if not exists replaced_by_payment_id uuid references public.payments(id) on delete set null,
  add column if not exists admin_note             text;

create unique index if not exists payments_reverses_uidx
  on public.payments (reverses_payment_id) where reverses_payment_id is not null;

-- ---------------------------------------------------------------------------
-- 2) Tables
-- ---------------------------------------------------------------------------
-- 2a) Adjustment documents on issued invoices (credit / debit notes,
--     write-offs, cancellations). Immutable except a one-time void.
create table if not exists public.invoice_adjustments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  invoice_id   uuid not null references public.invoices(id) on delete restrict,
  number       text not null,
  kind         text not null check (kind in ('credit_note', 'debit_note', 'write_off', 'cancellation')),
  amount       numeric(12,2) not null check (amount > 0),
  currency     text not null check (currency ~ '^[A-Z]{3}$'),
  tax_rate     numeric(6,3) not null default 0,
  tax_amount   numeric(12,2) not null default 0,
  description  text,
  reason       text not null check (length(btrim(reason)) > 0),
  created_by   uuid references public.profiles(id) on delete set null,
  voided_at    timestamptz,
  voided_by    uuid references public.profiles(id) on delete set null,
  void_reason  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_id, number)
);
create index if not exists idx_invoice_adjustments_org     on public.invoice_adjustments(org_id);
create index if not exists idx_invoice_adjustments_invoice on public.invoice_adjustments(invoice_id);

-- 2b) Family money credit (overpayments, goodwill, credit applied to invoices).
--     Append-only ledger; balance per family + currency = sum(amount).
create table if not exists public.family_credit_entries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  family_id   uuid not null references public.families(id) on delete restrict,
  amount      numeric(12,2) not null check (amount <> 0),
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  kind        text not null check (kind in ('overpayment', 'applied', 'manual', 'reversal')),
  invoice_id  uuid references public.invoices(id) on delete restrict,
  payment_id  uuid references public.payments(id) on delete restrict,
  reason      text not null check (length(btrim(reason)) > 0),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_family_credit_org    on public.family_credit_entries(org_id);
create index if not exists idx_family_credit_family on public.family_credit_entries(family_id, currency);

-- 2c) Training-credit ledger (grants, adjustments, revocations with reasons).
create table if not exists public.training_credit_adjustments (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  athlete_id      uuid not null references public.athletes(id) on delete cascade,
  credit_category public.credit_category not null,
  kind            text not null check (kind in ('grant', 'adjust', 'revoke')),
  delta           integer not null check (delta <> 0),
  total_before    integer not null,
  total_after     integer not null check (total_after >= 0),
  used_at_time    integer not null default 0,
  reason          text not null check (length(btrim(reason)) > 0),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_credit_adj_org     on public.training_credit_adjustments(org_id);
create index if not exists idx_credit_adj_athlete on public.training_credit_adjustments(athlete_id, credit_category);

-- ---------------------------------------------------------------------------
-- 3) Immutability guards
-- ---------------------------------------------------------------------------
-- Payments: still append-only. The money-editing RPCs (and only they) may
-- set the void / annotation columns, signalled by a transaction-local setting
-- that PostgREST clients cannot set. Amount, method, invoice, dates and Stripe
-- ids can never change; a voided row can't be un-voided.
create or replace function public.payments_block_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_free constant text[] := array['voided_at', 'voided_by', 'void_reason', 'replaced_by_payment_id', 'admin_note', 'updated_at'];
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('app.money_edit', true), '') = 'on' then
    if (to_jsonb(new) - v_free) = (to_jsonb(old) - v_free)
       and (old.voided_at is null or new.voided_at is not distinct from old.voided_at) then
      return new;
    end if;
  end if;
  raise exception 'payments are append-only; record a new payment/refund row instead of % ', tg_op
    using errcode = 'P0001';
end;
$$;

-- Adjustments: only the void columns, once, from the RPCs.
create or replace function public.invoice_adjustments_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_free constant text[] := array['voided_at', 'voided_by', 'void_reason', 'updated_at'];
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('app.money_edit', true), '') = 'on'
     and old.voided_at is null
     and (to_jsonb(new) - v_free) = (to_jsonb(old) - v_free) then
    return new;
  end if;
  raise exception 'invoice adjustments are immutable; void with a reason instead of %', tg_op
    using errcode = 'P0001';
end;
$$;

-- Ledgers: never updated or deleted (compensating rows only).
create or replace function public.money_ledger_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is append-only; add a compensating entry instead of %', tg_table_name, tg_op
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_invoice_adjustments_guard on public.invoice_adjustments;
create trigger trg_invoice_adjustments_guard
  before update or delete on public.invoice_adjustments
  for each row execute function public.invoice_adjustments_guard();
drop trigger if exists trg_invoice_adjustments_updated on public.invoice_adjustments;
create trigger trg_invoice_adjustments_updated
  before update on public.invoice_adjustments
  for each row execute function public.set_updated_at();

drop trigger if exists trg_family_credit_append_only on public.family_credit_entries;
create trigger trg_family_credit_append_only
  before update or delete on public.family_credit_entries
  for each row execute function public.money_ledger_append_only();

drop trigger if exists trg_credit_adj_append_only on public.training_credit_adjustments;
create trigger trg_credit_adj_append_only
  before update or delete on public.training_credit_adjustments
  for each row execute function public.money_ledger_append_only();

-- ---------------------------------------------------------------------------
-- 4) RLS: read for finance of the org (+ guardians for their own family's
--    documents and credit); no direct writes, everything goes through the
--    RPCs below. Restrictive tenant + suspension guards as for every table.
-- ---------------------------------------------------------------------------
alter table public.invoice_adjustments         enable row level security;
alter table public.invoice_adjustments         force row level security;
alter table public.family_credit_entries       enable row level security;
alter table public.family_credit_entries       force row level security;
alter table public.training_credit_adjustments enable row level security;
alter table public.training_credit_adjustments force row level security;

drop policy if exists invoice_adjustments_select on public.invoice_adjustments;
create policy invoice_adjustments_select on public.invoice_adjustments for select
  using (
    org_id = public.current_org_id()
    and (
      public.is_finance()
      or exists (select 1 from public.invoices i
                  where i.id = invoice_adjustments.invoice_id and public.is_guardian_of_family(i.family_id))
    )
  );
drop policy if exists invoice_adjustments_no_insert on public.invoice_adjustments;
create policy invoice_adjustments_no_insert on public.invoice_adjustments for insert with check (false);
drop policy if exists invoice_adjustments_no_update on public.invoice_adjustments;
create policy invoice_adjustments_no_update on public.invoice_adjustments for update using (false) with check (false);
drop policy if exists invoice_adjustments_no_delete on public.invoice_adjustments;
create policy invoice_adjustments_no_delete on public.invoice_adjustments for delete using (false);

drop policy if exists family_credit_select on public.family_credit_entries;
create policy family_credit_select on public.family_credit_entries for select
  using (org_id = public.current_org_id() and (public.is_finance() or public.is_guardian_of_family(family_id)));
drop policy if exists family_credit_no_insert on public.family_credit_entries;
create policy family_credit_no_insert on public.family_credit_entries for insert with check (false);
drop policy if exists family_credit_no_update on public.family_credit_entries;
create policy family_credit_no_update on public.family_credit_entries for update using (false) with check (false);
drop policy if exists family_credit_no_delete on public.family_credit_entries;
create policy family_credit_no_delete on public.family_credit_entries for delete using (false);

drop policy if exists credit_adj_select on public.training_credit_adjustments;
create policy credit_adj_select on public.training_credit_adjustments for select
  using (org_id = public.current_org_id() and public.is_finance());
drop policy if exists credit_adj_no_insert on public.training_credit_adjustments;
create policy credit_adj_no_insert on public.training_credit_adjustments for insert with check (false);
drop policy if exists credit_adj_no_update on public.training_credit_adjustments;
create policy credit_adj_no_update on public.training_credit_adjustments for update using (false) with check (false);
drop policy if exists credit_adj_no_delete on public.training_credit_adjustments;
create policy credit_adj_no_delete on public.training_credit_adjustments for delete using (false);

do $$
declare t text;
begin
  foreach t in array array['invoice_adjustments', 'family_credit_entries', 'training_credit_adjustments'] loop
    execute format('drop policy if exists platform_tenant_isolation on public.%I', t);
    execute format(
      'create policy platform_tenant_isolation on public.%I as restrictive for all
         using (org_id = (select public.current_org_id()))
         with check (org_id = (select public.current_org_id()))', t);
    execute format('drop policy if exists platform_suspension_guard on public.%I', t);
    execute format(
      'create policy platform_suspension_guard on public.%I as restrictive for all
         using (not coalesce(org_id = any ((select public.suspended_org_ids())::uuid[]), false))
         with check (not coalesce(org_id = any ((select public.suspended_org_ids())::uuid[]), false))', t);
    execute format('revoke insert, update, delete, truncate on public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant select on public.%I to authenticated', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant select, insert, update on public.%I to service_role', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5) Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------------
-- Finance guard + invoice of the caller's org, locked for the transaction.
create or replace function public.money_invoice_for_update(p_invoice uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare v public.invoices;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into v from public.invoices
   where id = p_invoice and org_id = public.current_org_id()
   for update;
  if not found then raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002'; end if;
  return v;
end;
$$;

-- Amount still due before payments: original total + adjustment documents.
create or replace function public.invoice_amount_due(p_invoice uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(total_chf, 0) + coalesce(adjustments_total, 0) from public.invoices where id = p_invoice;
$$;

-- Re-derive invoices.adjustments_total from the active adjustment documents.
create or replace function public.refresh_invoice_adjustments(p_invoice uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v_sum numeric;
begin
  select coalesce(sum(case when kind = 'debit_note' then amount else -amount end), 0) into v_sum
    from public.invoice_adjustments
   where invoice_id = p_invoice and voided_at is null;
  perform set_config('app.money_edit', 'on', true);
  update public.invoices set adjustments_total = v_sum where id = p_invoice;
  perform set_config('app.money_edit', 'off', true);
  return v_sum;
end;
$$;

-- Signed-in users (PostgREST: finance has UPDATE on invoices via RLS) can no
-- longer change an issued amount directly: adjustments_total only moves via
-- the adjustment RPCs, and an issued, non-zero total_chf is frozen (credit /
-- debit notes instead). Inserts-then-fill RPCs (old total 0), drafts, the
-- service role / webhooks (no auth.uid()) are unaffected.
create or replace function public.invoices_money_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(current_setting('app.money_edit', true), '') = 'on' then
    return new;
  end if;
  if new.adjustments_total is distinct from old.adjustments_total then
    raise exception 'INVOICE_LOCKED: adjustments change only through credit / debit notes' using errcode = 'P0001';
  end if;
  if old.status::text <> 'draft' and coalesce(old.total_chf, 0) <> 0
     and new.total_chf is distinct from old.total_chf then
    raise exception 'INVOICE_LOCKED: an issued amount cannot change; issue a credit or debit note' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoices_money_guard on public.invoices;
create trigger trg_invoices_money_guard
  before update on public.invoices
  for each row execute function public.invoices_money_guard();

-- Keep 'overdue' honest after a due-date / amount change on one invoice.
create or replace function public.refresh_invoice_overdue(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v public.invoices; v_paid numeric;
begin
  select * into v from public.invoices where id = p_invoice;
  if not found then return; end if;
  if v.status::text in ('sent', 'partially_paid') and v.due_date is not null and v.due_date < current_date then
    update public.invoices set status = 'overdue' where id = p_invoice;
  elsif v.status::text = 'overdue' and (v.due_date is null or v.due_date >= current_date) then
    v_paid := public.invoice_net_paid(p_invoice);
    update public.invoices
       set status = (case when v_paid > 0 then 'partially_paid' else 'sent' end)::public.invoice_status
     where id = p_invoice;
  end if;
end;
$$;

create or replace function public.family_credit_balance(p_family uuid, p_currency text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0) from public.family_credit_entries
   where family_id = p_family and currency = upper(p_currency);
$$;

create or replace function public.money_audit(
  p_org uuid, p_action text, p_table text, p_target uuid, p_old jsonb, p_new jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (p_org, auth.uid(), p_action, p_table, p_target, p_old, p_new);
$$;

-- Money snapshot used in before/after audit rows.
create or replace function public.invoice_money_snapshot(p_invoice uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'status', i.status, 'currency', i.currency, 'total', i.total_chf,
    'adjustments', i.adjustments_total, 'amount_due', i.total_chf + i.adjustments_total,
    'paid', public.invoice_net_paid(i.id),
    'balance', i.total_chf + i.adjustments_total - public.invoice_net_paid(i.id))
  from public.invoices i where i.id = p_invoice;
$$;

-- ---------------------------------------------------------------------------
-- 6) recompute_invoice: same transitions as before, but against the amount
--    due (total + adjustments), an active write-off keeps 'written_off', and
--    an overpayment is flagged in audit_logs (INVOICE_OVERPAID).
--    Called by the Stripe webhook RPCs too; for invoices without adjustments
--    the result is identical to 20250420091800.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_invoice(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_paid  numeric;
  v_cur   public.invoice_status;
  v_wo    boolean;
  v_org   uuid;
begin
  select total_chf + coalesce(adjustments_total, 0), status, org_id into v_total, v_cur, v_org
    from public.invoices where id = p_invoice for update;
  if not found then return; end if;

  v_paid := public.invoice_net_paid(p_invoice);
  v_wo := exists (select 1 from public.invoice_adjustments
                   where invoice_id = p_invoice and kind = 'write_off' and voided_at is null);

  if v_wo then
    if v_cur::text <> 'written_off' then
      update public.invoices set status = 'written_off'::public.invoice_status where id = p_invoice;
    end if;
  elsif v_paid <= 0 then
    if v_cur::text in ('paid', 'partially_paid', 'written_off') then
      update public.invoices set status = 'sent', paid_at = null where id = p_invoice;
    end if;
  elsif v_paid < v_total then
    update public.invoices set status = 'partially_paid', paid_at = null where id = p_invoice;
  else
    update public.invoices set status = 'paid', paid_at = coalesce(paid_at, now()) where id = p_invoice;
  end if;

  -- Flag an overpayment once per paid level (closes the "overpayments not
  -- flagged" gap): finance sees it on the invoice and moves the excess to
  -- the family's credit with transfer_overpayment_to_credit().
  if v_paid > v_total and not exists (
       select 1 from public.audit_logs
        where target_table = 'invoices' and target_id = p_invoice and action = 'INVOICE_OVERPAID'
          and (new_data->>'paid')::numeric = v_paid) then
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
    values (v_org, auth.uid(), 'INVOICE_OVERPAID', 'invoices', p_invoice,
            jsonb_build_object('amount_due', v_total, 'paid', v_paid, 'overpaid', v_paid - v_total));
  end if;

  perform public.refresh_installment_status(p_invoice);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Invoice RPCs
-- ---------------------------------------------------------------------------
-- 7a) Edit a draft (never issued) invoice freely.
create or replace function public.update_draft_invoice(p_invoice uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v        public.invoices;
  v_exp    int;
  v_item   jsonb;
  v_qty    numeric;
  v_price  numeric;
  v_amount numeric;
  v_total  numeric := 0;
  v_disc   numeric;
  v_family uuid;
  v_old    jsonb;
  v_rate   numeric;
  v_incl   boolean;
  v_locale text;
  v_n      int := 0;
begin
  v := public.money_invoice_for_update(p_invoice);
  if v.status::text <> 'draft' then raise exception 'INVOICE_NOT_DRAFT' using errcode = 'P0001'; end if;
  v_exp := public.currency_exponent(v.currency);

  v_family := coalesce(nullif(p_payload->>'family_id', '')::uuid, v.family_id);
  if not exists (select 1 from public.families where id = v_family and org_id = v.org_id) then
    raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_rate := coalesce(nullif(p_payload->>'tax_rate', '')::numeric, v.tax_rate);
  if v_rate < 0 or v_rate > 100 then raise exception 'INVALID_TAX_RATE' using errcode = 'P0001'; end if;
  v_incl := coalesce((p_payload->>'tax_inclusive')::boolean, v.tax_inclusive);
  v_locale := case when p_payload ? 'locale' then nullif(p_payload->>'locale', '') else v.locale end;

  if jsonb_typeof(p_payload->'items') <> 'array' or jsonb_array_length(p_payload->'items') = 0 then
    raise exception 'NO_ITEMS' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
           'invoice', public.invoice_money_snapshot(v.id),
           'family_id', v.family_id, 'due_date', v.due_date, 'description', v.description,
           'notes', v.notes, 'locale', v.locale, 'tax_rate', v.tax_rate, 'tax_inclusive', v.tax_inclusive,
           'items', coalesce((select jsonb_agg(jsonb_build_object('description', description, 'quantity', quantity,
                                                                 'unit_price', unit_price_chf, 'amount', amount_chf) order by created_at)
                               from public.invoice_items where invoice_id = v.id), '[]'::jsonb))
    into v_old;

  delete from public.invoice_items where invoice_id = v.id;

  for v_item in select * from jsonb_array_elements(p_payload->'items') loop
    v_qty   := coalesce(nullif(v_item->>'quantity', '')::numeric, 1);
    v_price := round(coalesce(nullif(v_item->>'unit_price', '')::numeric, 0), v_exp);
    if v_qty <= 0 then raise exception 'INVALID_QUANTITY' using errcode = 'P0001'; end if;
    if coalesce(btrim(v_item->>'description'), '') = '' then raise exception 'ITEM_DESCRIPTION_REQUIRED' using errcode = 'P0001'; end if;
    v_amount := round(v_qty * v_price, v_exp);
    v_n := v_n + 1;
    -- created_at offsets keep the entered line order stable.
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf, created_at)
    values (v.org_id, v.id, btrim(v_item->>'description'), v_qty, v_price, v_amount, now() + make_interval(secs => v_n * 0.001));
    v_total := v_total + v_amount;
  end loop;

  v_disc := round(coalesce(nullif(p_payload->>'discount', '')::numeric, 0), v_exp);
  if v_disc < 0 then raise exception 'INVALID_DISCOUNT' using errcode = 'P0001'; end if;
  if v_disc > 0 then
    v_n := v_n + 1;
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf, created_at)
    values (v.org_id, v.id, coalesce(nullif(btrim(p_payload->>'discount_label'), ''), 'Discount'), 1, -v_disc, -v_disc,
            now() + make_interval(secs => v_n * 0.001));
    v_total := v_total - v_disc;
  end if;
  if v_total < 0 then raise exception 'INVALID_TOTAL' using errcode = 'P0001'; end if;

  update public.invoices
     set family_id     = v_family,
         athlete_id    = case when v_family = v.family_id then athlete_id
                              when exists (select 1 from public.athletes a where a.id = v.athlete_id and a.family_id = v_family) then athlete_id
                              else null end,
         description   = case when p_payload ? 'description' then nullif(btrim(p_payload->>'description'), '') else description end,
         due_date      = case when p_payload ? 'due_date' then nullif(p_payload->>'due_date', '')::date else due_date end,
         notes         = case when p_payload ? 'notes' then nullif(btrim(p_payload->>'notes'), '') else notes end,
         locale        = v_locale,
         tax_rate      = v_rate,
         tax_inclusive = v_incl,
         total_chf     = v_total,
         subtotal_amount = v_total
   where id = v.id;

  perform public.money_audit(v.org_id, 'INVOICE_EDITED', 'invoices', v.id, v_old,
    jsonb_build_object(
      'invoice', public.invoice_money_snapshot(v.id),
      'family_id', v_family, 'tax_rate', v_rate, 'tax_inclusive', v_incl,
      'items', (select jsonb_agg(jsonb_build_object('description', description, 'quantity', quantity,
                                                   'unit_price', unit_price_chf, 'amount', amount_chf) order by created_at)
                  from public.invoice_items where invoice_id = v.id)));

  return jsonb_build_object('invoice_id', v.id, 'total', (select total_chf from public.invoices where id = v.id));
end;
$$;

-- 7b) Safe edits on any invoice: due date, notes, language, reminder pause.
create or replace function public.update_invoice_details(p_invoice uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.invoices;
  v_new public.invoices;
begin
  v := public.money_invoice_for_update(p_invoice);
  if v.status::text = 'void' then raise exception 'INVOICE_LOCKED' using errcode = 'P0001'; end if;
  if p_payload ? 'locale' and nullif(p_payload->>'locale', '') is not null
     and p_payload->>'locale' not in ('en', 'de', 'fr', 'it', 'es') then
    raise exception 'INVALID_LOCALE' using errcode = 'P0001';
  end if;

  update public.invoices
     set due_date         = case when p_payload ? 'due_date' then nullif(p_payload->>'due_date', '')::date else due_date end,
         notes            = case when p_payload ? 'notes' then nullif(btrim(p_payload->>'notes'), '') else notes end,
         locale           = case when p_payload ? 'locale' then nullif(p_payload->>'locale', '') else locale end,
         reminders_paused = coalesce((p_payload->>'reminders_paused')::boolean, reminders_paused)
   where id = v.id
  returning * into v_new;

  perform public.refresh_invoice_overdue(v.id);

  perform public.money_audit(v.org_id, 'INVOICE_DETAILS_EDITED', 'invoices', v.id,
    jsonb_build_object('due_date', v.due_date, 'notes', v.notes, 'locale', v.locale,
                       'reminders_paused', v.reminders_paused, 'status', v.status),
    jsonb_build_object('due_date', v_new.due_date, 'notes', v_new.notes, 'locale', v_new.locale,
                       'reminders_paused', v_new.reminders_paused,
                       'status', (select status from public.invoices where id = v.id)));

  return jsonb_build_object('invoice_id', v.id, 'status', (select status from public.invoices where id = v.id));
end;
$$;

-- Shared: append an adjustment document and re-derive the invoice.
create or replace function public.money_add_adjustment(
  v public.invoices, p_kind text, p_amount numeric, p_reason text, p_description text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_prefix text := case p_kind when 'credit_note' then 'CN' when 'debit_note' then 'DN'
                               when 'write_off' then 'WO' else 'CX' end;
  v_seq    int;
  v_rate   numeric := case when v.reverse_charge then 0 else coalesce(v.tax_rate, 0) end;
  v_exp    int := public.currency_exponent(v.currency);
begin
  select count(*) + 1 into v_seq from public.invoice_adjustments where invoice_id = v.id;
  insert into public.invoice_adjustments
    (org_id, invoice_id, number, kind, amount, currency, tax_rate, tax_amount, description, reason, created_by)
  values
    (v.org_id, v.id, v.number || '-' || v_prefix || v_seq, p_kind, p_amount, v.currency, v_rate,
     round(p_amount * v_rate / (100 + v_rate), v_exp),
     nullif(btrim(coalesce(p_description, '')), ''), btrim(p_reason), auth.uid())
  returning id into v_id;
  perform public.refresh_invoice_adjustments(v.id);
  return v_id;
end;
$$;

-- 7c) Credit note / debit note / write-off on an issued invoice.
create or replace function public.issue_invoice_adjustment(
  p_invoice uuid, p_kind text, p_amount numeric, p_reason text, p_description text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v        public.invoices;
  v_before jsonb;
  v_due    numeric;
  v_paid   numeric;
  v_amount numeric;
  v_id     uuid;
begin
  v := public.money_invoice_for_update(p_invoice);
  if p_kind not in ('credit_note', 'debit_note', 'write_off') then raise exception 'INVALID_KIND' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if v.status::text = 'draft' then raise exception 'INVOICE_IS_DRAFT' using errcode = 'P0001'; end if;
  if v.status::text in ('cancelled', 'void') then raise exception 'INVOICE_CANCELLED' using errcode = 'P0001'; end if;
  if v.status::text = 'written_off' then raise exception 'INVOICE_WRITTEN_OFF' using errcode = 'P0001'; end if;

  v_before := public.invoice_money_snapshot(v.id);
  v_due  := v.total_chf + v.adjustments_total;
  v_paid := public.invoice_net_paid(v.id);

  if p_kind = 'write_off' then
    v_amount := v_due - v_paid;                       -- always the whole open balance
    if v_amount <= 0 then raise exception 'NOTHING_TO_WRITE_OFF' using errcode = 'P0001'; end if;
  else
    v_amount := round(coalesce(p_amount, 0), public.currency_exponent(v.currency));
    if v_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
    if p_kind = 'credit_note' then
      if v_amount > v_due then raise exception 'CREDIT_EXCEEDS_AMOUNT_DUE' using errcode = 'P0001'; end if;
      -- Crediting an unpaid invoice down to zero is a cancellation.
      if v_amount = v_due and v_paid <= 0 then raise exception 'USE_CANCEL' using errcode = 'P0001'; end if;
    end if;
  end if;

  v_id := public.money_add_adjustment(v, p_kind, v_amount, p_reason, p_description);
  if p_kind = 'write_off' then
    update public.invoices set written_off_at = now() where id = v.id;
  end if;
  perform public.recompute_invoice(v.id);
  perform public.refresh_invoice_overdue(v.id);

  perform public.money_audit(v.org_id, 'INVOICE_ADJUSTMENT_ISSUED', 'invoices', v.id, v_before,
    public.invoice_money_snapshot(v.id) || jsonb_build_object(
      'adjustment_id', v_id, 'kind', p_kind, 'adjustment_amount', v_amount, 'reason', btrim(p_reason)));

  return jsonb_build_object('adjustment_id', v_id,
                            'number', (select number from public.invoice_adjustments where id = v_id),
                            'amount', v_amount,
                            'status', (select status from public.invoices where id = v.id));
end;
$$;

-- 7d) Void an adjustment document (e.g. reverse a write-off when the money
--     arrives after all). Cancellations are undone with reopen_invoice.
create or replace function public.void_invoice_adjustment(p_adjustment uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a        public.invoice_adjustments;
  v        public.invoices;
  v_before jsonb;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into a from public.invoice_adjustments
   where id = p_adjustment and org_id = public.current_org_id();
  if not found then raise exception 'ADJUSTMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if a.voided_at is not null then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  if a.kind = 'cancellation' then raise exception 'USE_REOPEN' using errcode = 'P0001'; end if;

  v := public.money_invoice_for_update(a.invoice_id);
  v_before := public.invoice_money_snapshot(v.id);

  perform set_config('app.money_edit', 'on', true);
  update public.invoice_adjustments
     set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = a.id;
  perform set_config('app.money_edit', 'off', true);

  perform public.refresh_invoice_adjustments(v.id);
  if a.kind = 'write_off' then
    update public.invoices set written_off_at = null where id = v.id;
  end if;
  perform public.recompute_invoice(v.id);
  perform public.refresh_invoice_overdue(v.id);

  perform public.money_audit(v.org_id, 'INVOICE_ADJUSTMENT_VOIDED', 'invoices', v.id, v_before,
    public.invoice_money_snapshot(v.id) || jsonb_build_object(
      'adjustment_id', a.id, 'kind', a.kind, 'adjustment_amount', a.amount, 'reason', btrim(p_reason)));

  return jsonb_build_object('adjustment_id', a.id, 'status', (select status from public.invoices where id = v.id));
end;
$$;

-- 7e) Cancel. Draft: just cancelled. Issued and unpaid: a cancellation
--     document for the full amount due. Anything with money on it: refused
--     (void / re-allocate / refund the payments first).
create or replace function public.cancel_invoice(p_invoice uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v        public.invoices;
  v_before jsonb;
  v_due    numeric;
begin
  v := public.money_invoice_for_update(p_invoice);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if v.status::text in ('cancelled', 'void') then raise exception 'ALREADY_CANCELLED' using errcode = 'P0001'; end if;
  if v.status::text in ('paid', 'written_off', 'refunded') then raise exception 'CANNOT_CANCEL' using errcode = 'P0001'; end if;
  if public.invoice_net_paid(v.id) <> 0 then raise exception 'HAS_PAYMENTS' using errcode = 'P0001'; end if;

  v_before := public.invoice_money_snapshot(v.id);
  v_due := v.total_chf + v.adjustments_total;
  if v.status::text <> 'draft' and v_due > 0 then
    perform public.money_add_adjustment(v, 'cancellation', v_due, p_reason, null);
  end if;

  update public.invoices
     set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason), paid_at = null
   where id = v.id;

  perform public.money_audit(v.org_id, 'INVOICE_CANCELLED', 'invoices', v.id, v_before,
    public.invoice_money_snapshot(v.id) || jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('invoice_id', v.id, 'status', 'cancelled');
end;
$$;

-- 7f) Reopen a cancelled invoice that never received money.
create or replace function public.reopen_invoice(p_invoice uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v        public.invoices;
  v_before jsonb;
  v_issued boolean;
begin
  v := public.money_invoice_for_update(p_invoice);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if v.status::text not in ('cancelled', 'void') then raise exception 'NOT_CANCELLED' using errcode = 'P0001'; end if;
  if exists (select 1 from public.payments
              where invoice_id = v.id and amount_chf > 0 and voided_at is null) then
    raise exception 'WAS_PAID' using errcode = 'P0001';
  end if;

  v_before := public.invoice_money_snapshot(v.id);
  v_issued := exists (select 1 from public.invoice_adjustments
                       where invoice_id = v.id and kind = 'cancellation' and voided_at is null);

  perform set_config('app.money_edit', 'on', true);
  update public.invoice_adjustments
     set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where invoice_id = v.id and kind = 'cancellation' and voided_at is null;
  perform set_config('app.money_edit', 'off', true);
  perform public.refresh_invoice_adjustments(v.id);

  -- Legacy cancellations (before this migration) carry no document: if the
  -- invoice has a payment reference and was not a draft we can't tell, so a
  -- reopened legacy invoice comes back as 'sent' unless it never left draft.
  update public.invoices
     set status = (case when v_issued or v.cancelled_at is null then 'sent' else 'draft' end)::public.invoice_status,
         cancelled_at = null, cancel_reason = null
   where id = v.id;
  perform public.refresh_invoice_overdue(v.id);

  perform public.money_audit(v.org_id, 'INVOICE_REOPENED', 'invoices', v.id, v_before,
    public.invoice_money_snapshot(v.id) || jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('invoice_id', v.id, 'status', (select status from public.invoices where id = v.id));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Payment RPCs
-- ---------------------------------------------------------------------------
-- Offline payment methods finance may record by hand.
create or replace function public.is_offline_payment_method(p_method text)
returns boolean
language sql
immutable
as $$ select coalesce(p_method, '') in ('manual', 'bank_transfer', 'twint', 'qr_bill', 'card') $$;

-- A payment row finance may void / edit: offline, not Stripe, not itself a
-- reversal, not already voided.
create or replace function public.payment_is_manual(p public.payments)
returns boolean
language sql
immutable
as $$
  select p.stripe_payment_intent_id is null and p.stripe_charge_id is null and p.stripe_refund_id is null
     and p.stripe_account_id is null and p.reverses_payment_id is null
$$;

-- 8a) Record an offline payment with its real date.
create or replace function public.record_offline_payment(
  p_invoice uuid, p_amount numeric, p_method text,
  p_paid_on date default null, p_reference text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v        public.invoices;
  v_amount numeric;
  v_pay    uuid;
  v_before jsonb;
  v_after  jsonb;
begin
  v := public.money_invoice_for_update(p_invoice);
  if not public.is_offline_payment_method(p_method) then raise exception 'INVALID_METHOD' using errcode = 'P0001'; end if;
  if v.status::text in ('cancelled', 'void') then raise exception 'INVOICE_CANCELLED' using errcode = 'P0001'; end if;
  if p_paid_on is not null and p_paid_on > current_date then raise exception 'INVALID_DATE' using errcode = 'P0001'; end if;
  v_amount := round(coalesce(p_amount, 0), public.currency_exponent(v.currency));
  if v_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;

  v_before := public.invoice_money_snapshot(v.id);
  insert into public.payments (org_id, invoice_id, amount_chf, currency, method, status, qr_reference, recorded_by, paid_at, notes)
  values (v.org_id, v.id, v_amount, v.currency, p_method::public.payment_method, 'succeeded',
          nullif(btrim(coalesce(p_reference, '')), ''), auth.uid(),
          case when p_paid_on is null or p_paid_on = current_date then now() else p_paid_on::timestamptz + interval '12 hours' end,
          nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_pay;

  perform public.recompute_invoice(v.id);
  perform public.refresh_invoice_overdue(v.id);
  v_after := public.invoice_money_snapshot(v.id);

  perform public.money_audit(v.org_id, 'PAYMENT_RECORDED', 'payments', v_pay, v_before,
    v_after || jsonb_build_object('invoice_id', v.id, 'payment_id', v_pay, 'amount_chf', v_amount, 'method', p_method));

  return jsonb_build_object('payment_id', v_pay, 'invoice_id', v.id, 'status', v_after->>'status',
                            'overpaid', greatest(0, -(v_after->>'balance')::numeric));
end;
$$;

-- Shared: void one manual payment (reversing row + flag). Caller has checked
-- the role and the org; returns the reversal id.
create or replace function public.money_void_payment(p public.payments, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rev uuid;
  v_fam uuid;
begin
  if not public.payment_is_manual(p) then raise exception 'STRIPE_PAYMENT_LOCKED' using errcode = 'P0001'; end if;
  if p.voided_at is not null then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  if p.status::text <> 'succeeded' then raise exception 'NOT_VOIDABLE' using errcode = 'P0001'; end if;

  select family_id into v_fam from public.invoices where id = p.invoice_id;

  -- Family-credit links get a compensating ledger entry.
  if p.method_detail = 'to_family_credit' then
    if public.family_credit_balance(v_fam, p.currency) < -p.amount_chf then
      raise exception 'CREDIT_ALREADY_USED' using errcode = 'P0001';
    end if;
    insert into public.family_credit_entries (org_id, family_id, amount, currency, kind, invoice_id, payment_id, reason, created_by)
    values (p.org_id, v_fam, p.amount_chf, p.currency, 'reversal', p.invoice_id, p.id, btrim(p_reason), auth.uid());
  elsif p.method_detail = 'family_credit' then
    insert into public.family_credit_entries (org_id, family_id, amount, currency, kind, invoice_id, payment_id, reason, created_by)
    values (p.org_id, v_fam, p.amount_chf, p.currency, 'reversal', p.invoice_id, p.id, btrim(p_reason), auth.uid());
  end if;

  insert into public.payments (org_id, invoice_id, amount_chf, currency, method, status, method_detail,
                               reverses_payment_id, recorded_by, paid_at, notes)
  values (p.org_id, p.invoice_id, -p.amount_chf, p.currency, p.method, 'succeeded', 'reversal',
          p.id, auth.uid(), now(), btrim(p_reason))
  returning id into v_rev;

  perform set_config('app.money_edit', 'on', true);
  update public.payments
     set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p.id;
  perform set_config('app.money_edit', 'off', true);
  return v_rev;
end;
$$;

-- 8b) Void a manual payment with a reason.
create or replace function public.void_payment(p_payment uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p        public.payments;
  v        public.invoices;
  v_before jsonb;
  v_rev    uuid;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into p from public.payments where id = p_payment and org_id = public.current_org_id();
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;

  v := public.money_invoice_for_update(p.invoice_id);
  select * into p from public.payments where id = p_payment;   -- re-read under the invoice lock
  v_before := public.invoice_money_snapshot(v.id);
  v_rev := public.money_void_payment(p, p_reason);

  perform public.recompute_invoice(v.id);
  perform public.refresh_invoice_overdue(v.id);

  perform public.money_audit(v.org_id, 'PAYMENT_VOIDED', 'payments', p.id,
    v_before || jsonb_build_object('invoice_id', v.id, 'payment_id', p.id, 'amount_chf', p.amount_chf, 'method', p.method),
    public.invoice_money_snapshot(v.id) || jsonb_build_object('invoice_id', v.id, 'payment_id', p.id,
      'reversal_id', v_rev, 'reason', btrim(p_reason)));

  return jsonb_build_object('payment_id', p.id, 'reversal_id', v_rev, 'status', (select status from public.invoices where id = v.id));
end;
$$;

-- 8c) Edit a manual payment (amount, date, method, reference, note, invoice).
--     Implemented as void + replacement so the ledger keeps both versions.
create or replace function public.edit_manual_payment(p_payment uuid, p_payload jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p          public.payments;
  v_src      public.invoices;
  v_dst      public.invoices;
  v_target   uuid;
  v_amount   numeric;
  v_method   text;
  v_paid_on  date;
  v_new      uuid;
  v_before   jsonb;
  v_before_d jsonb;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into p from public.payments where id = p_payment and org_id = public.current_org_id();
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.payment_is_manual(p) then raise exception 'STRIPE_PAYMENT_LOCKED' using errcode = 'P0001'; end if;
  if p.amount_chf <= 0 or coalesce(p.method_detail, '') in ('family_credit', 'to_family_credit', 'reversal') then
    raise exception 'NOT_EDITABLE' using errcode = 'P0001';
  end if;

  v_target := coalesce(nullif(p_payload->>'invoice_id', '')::uuid, p.invoice_id);
  -- Lock both invoices in a stable order (no deadlock between two editors).
  if v_target <> p.invoice_id and v_target < p.invoice_id then
    v_dst := public.money_invoice_for_update(v_target);
    v_src := public.money_invoice_for_update(p.invoice_id);
  else
    v_src := public.money_invoice_for_update(p.invoice_id);
    v_dst := case when v_target = p.invoice_id then v_src else public.money_invoice_for_update(v_target) end;
  end if;
  select * into p from public.payments where id = p_payment;
  if v_dst.currency <> p.currency then raise exception 'CURRENCY_MISMATCH' using errcode = 'P0001'; end if;
  if v_dst.status::text in ('cancelled', 'void') then raise exception 'INVOICE_CANCELLED' using errcode = 'P0001'; end if;

  v_amount := round(coalesce(nullif(p_payload->>'amount', '')::numeric, p.amount_chf), public.currency_exponent(p.currency));
  if v_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  v_method := coalesce(nullif(p_payload->>'method', ''), p.method::text);
  if not public.is_offline_payment_method(v_method) then raise exception 'INVALID_METHOD' using errcode = 'P0001'; end if;
  v_paid_on := coalesce(nullif(p_payload->>'paid_on', '')::date, (p.paid_at at time zone 'UTC')::date);
  if v_paid_on > current_date then raise exception 'INVALID_DATE' using errcode = 'P0001'; end if;

  v_before   := public.invoice_money_snapshot(v_src.id);
  v_before_d := public.invoice_money_snapshot(v_dst.id);

  perform public.money_void_payment(p, p_reason);

  insert into public.payments (org_id, invoice_id, amount_chf, currency, method, status, qr_reference, recorded_by, paid_at, notes)
  values (p.org_id, v_dst.id, v_amount, p.currency, v_method::public.payment_method, 'succeeded',
          case when p_payload ? 'reference' then nullif(btrim(p_payload->>'reference'), '') else p.qr_reference end,
          auth.uid(),
          case when v_paid_on = (p.paid_at at time zone 'UTC')::date then p.paid_at
               when v_paid_on = current_date then now()
               else v_paid_on::timestamptz + interval '12 hours' end,
          case when p_payload ? 'note' then nullif(btrim(p_payload->>'note'), '') else p.notes end)
  returning id into v_new;

  perform set_config('app.money_edit', 'on', true);
  update public.payments set replaced_by_payment_id = v_new where id = p.id;
  perform set_config('app.money_edit', 'off', true);

  perform public.recompute_invoice(v_src.id);
  perform public.refresh_invoice_overdue(v_src.id);
  if v_dst.id <> v_src.id then
    perform public.recompute_invoice(v_dst.id);
    perform public.refresh_invoice_overdue(v_dst.id);
  end if;

  perform public.money_audit(p.org_id,
    case when v_dst.id <> v_src.id then 'PAYMENT_REALLOCATED' else 'PAYMENT_EDITED' end, 'payments', p.id,
    jsonb_build_object('invoice_id', v_src.id, 'payment_id', p.id, 'amount_chf', p.amount_chf, 'method', p.method,
                       'paid_at', p.paid_at, 'reference', p.qr_reference, 'invoice', v_before, 'target_invoice', v_before_d),
    jsonb_build_object('invoice_id', v_dst.id, 'payment_id', v_new, 'replaces', p.id, 'amount_chf', v_amount,
                       'method', v_method, 'paid_on', v_paid_on, 'reason', btrim(p_reason),
                       'invoice', public.invoice_money_snapshot(v_src.id),
                       'target_invoice', public.invoice_money_snapshot(v_dst.id)));

  return jsonb_build_object('payment_id', v_new, 'invoice_id', v_dst.id, 'replaces', p.id);
end;
$$;

-- 8d) Annotate any payment (Stripe ones included) — never changes money.
create or replace function public.annotate_payment(p_payment uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare p public.payments;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into p from public.payments where id = p_payment and org_id = public.current_org_id();
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;

  perform set_config('app.money_edit', 'on', true);
  update public.payments set admin_note = nullif(btrim(coalesce(p_note, '')), '') where id = p.id;
  perform set_config('app.money_edit', 'off', true);

  perform public.money_audit(p.org_id, 'PAYMENT_ANNOTATED', 'payments', p.id,
    jsonb_build_object('invoice_id', p.invoice_id, 'admin_note', p.admin_note),
    jsonb_build_object('invoice_id', p.invoice_id, 'admin_note', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('payment_id', p.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) Overpayments and family credit
-- ---------------------------------------------------------------------------
-- 9a) Move (part of) an invoice's overpayment to the family's credit.
create or replace function public.transfer_overpayment_to_credit(p_invoice uuid, p_amount numeric default null, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v        public.invoices;
  v_before jsonb;
  v_over   numeric;
  v_amount numeric;
  v_pay    uuid;
  v_reason text := coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Overpayment');
begin
  v := public.money_invoice_for_update(p_invoice);
  v_before := public.invoice_money_snapshot(v.id);
  v_over := public.invoice_net_paid(v.id) - (v.total_chf + v.adjustments_total);
  if v_over <= 0 then raise exception 'NO_OVERPAYMENT' using errcode = 'P0001'; end if;
  v_amount := round(coalesce(p_amount, v_over), public.currency_exponent(v.currency));
  if v_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  if v_amount > v_over then raise exception 'AMOUNT_EXCEEDS_OVERPAYMENT' using errcode = 'P0001'; end if;

  insert into public.payments (org_id, invoice_id, amount_chf, currency, method, status, method_detail, recorded_by, paid_at, notes)
  values (v.org_id, v.id, -v_amount, v.currency, 'manual', 'succeeded', 'to_family_credit', auth.uid(), now(), v_reason)
  returning id into v_pay;
  insert into public.family_credit_entries (org_id, family_id, amount, currency, kind, invoice_id, payment_id, reason, created_by)
  values (v.org_id, v.family_id, v_amount, v.currency, 'overpayment', v.id, v_pay, v_reason, auth.uid());

  perform public.recompute_invoice(v.id);
  perform public.money_audit(v.org_id, 'OVERPAYMENT_TO_CREDIT', 'payments', v_pay, v_before,
    public.invoice_money_snapshot(v.id) || jsonb_build_object(
      'invoice_id', v.id, 'payment_id', v_pay, 'family_id', v.family_id, 'amount_chf', v_amount,
      'family_credit', public.family_credit_balance(v.family_id, v.currency)));

  return jsonb_build_object('payment_id', v_pay, 'amount', v_amount,
                            'family_credit', public.family_credit_balance(v.family_id, v.currency));
end;
$$;

-- 9b) Pay (part of) an invoice from the family's credit.
create or replace function public.apply_family_credit(p_invoice uuid, p_amount numeric default null, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v        public.invoices;
  v_before jsonb;
  v_open   numeric;
  v_credit numeric;
  v_amount numeric;
  v_pay    uuid;
  v_reason text := coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Family credit');
begin
  v := public.money_invoice_for_update(p_invoice);
  if v.status::text in ('draft', 'cancelled', 'void', 'written_off') then raise exception 'INVOICE_NOT_PAYABLE' using errcode = 'P0001'; end if;
  -- Serialise credit use per family.
  perform 1 from public.families where id = v.family_id for update;
  v_before := public.invoice_money_snapshot(v.id);
  v_open := (v.total_chf + v.adjustments_total) - public.invoice_net_paid(v.id);
  if v_open <= 0 then raise exception 'NOTHING_DUE' using errcode = 'P0001'; end if;
  v_credit := public.family_credit_balance(v.family_id, v.currency);
  if v_credit <= 0 then raise exception 'NO_CREDIT' using errcode = 'P0001'; end if;
  v_amount := round(coalesce(p_amount, least(v_open, v_credit)), public.currency_exponent(v.currency));
  if v_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  if v_amount > least(v_open, v_credit) then raise exception 'AMOUNT_TOO_HIGH' using errcode = 'P0001'; end if;

  insert into public.payments (org_id, invoice_id, amount_chf, currency, method, status, method_detail, recorded_by, paid_at, notes)
  values (v.org_id, v.id, v_amount, v.currency, 'manual', 'succeeded', 'family_credit', auth.uid(), now(), v_reason)
  returning id into v_pay;
  insert into public.family_credit_entries (org_id, family_id, amount, currency, kind, invoice_id, payment_id, reason, created_by)
  values (v.org_id, v.family_id, -v_amount, v.currency, 'applied', v.id, v_pay, v_reason, auth.uid());

  perform public.recompute_invoice(v.id);
  perform public.refresh_invoice_overdue(v.id);
  perform public.money_audit(v.org_id, 'FAMILY_CREDIT_APPLIED', 'payments', v_pay, v_before,
    public.invoice_money_snapshot(v.id) || jsonb_build_object(
      'invoice_id', v.id, 'payment_id', v_pay, 'family_id', v.family_id, 'amount_chf', v_amount,
      'family_credit', public.family_credit_balance(v.family_id, v.currency)));

  return jsonb_build_object('payment_id', v_pay, 'amount', v_amount,
                            'family_credit', public.family_credit_balance(v.family_id, v.currency));
end;
$$;

-- 9c) Manual family-credit correction (goodwill credit, credit paid out in
--     cash / by bank). The balance can never go below zero.
create or replace function public.adjust_family_credit(p_family uuid, p_currency text, p_amount numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_cur    text := upper(coalesce(p_currency, ''));
  v_amount numeric;
  v_before numeric;
  v_id     uuid;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY' using errcode = 'P0001'; end if;
  select org_id into v_org from public.families
   where id = p_family and org_id = public.current_org_id()
   for update;
  if not found then raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002'; end if;
  v_amount := round(coalesce(p_amount, 0), public.currency_exponent(v_cur));
  if v_amount = 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  v_before := public.family_credit_balance(p_family, v_cur);
  if v_before + v_amount < 0 then raise exception 'CREDIT_NEGATIVE' using errcode = 'P0001'; end if;

  insert into public.family_credit_entries (org_id, family_id, amount, currency, kind, reason, created_by)
  values (v_org, p_family, v_amount, v_cur, 'manual', btrim(p_reason), auth.uid())
  returning id into v_id;

  perform public.money_audit(v_org, 'FAMILY_CREDIT_ADJUSTED', 'family_credit_entries', v_id,
    jsonb_build_object('family_id', p_family, 'currency', v_cur, 'balance', v_before),
    jsonb_build_object('family_id', p_family, 'currency', v_cur, 'amount', v_amount,
                       'balance', v_before + v_amount, 'reason', btrim(p_reason)));
  return jsonb_build_object('entry_id', v_id, 'balance', v_before + v_amount);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10) Training credits: grant / adjust / revoke with a reason
-- ---------------------------------------------------------------------------
create or replace function public.adjust_training_credits(
  p_athlete uuid, p_category text, p_delta integer default null, p_new_total integer default null, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid;
  v_cat   public.credit_category;
  v_total int := 0;
  v_used  int := 0;
  v_delta int;
  v_after int;
  v_kind  text;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if p_category not in ('personal', 'nutrition', 'mental') then raise exception 'INVALID_CATEGORY' using errcode = 'P0001'; end if;
  v_cat := p_category::public.credit_category;
  select org_id into v_org from public.athletes where id = p_athlete and org_id = public.current_org_id();
  if not found then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  if (p_delta is null) = (p_new_total is null) then raise exception 'INVALID_CREDITS' using errcode = 'P0001'; end if;

  select total_credits, used_credits into v_total, v_used
    from public.training_credits where athlete_id = p_athlete and credit_category = v_cat
   for update;
  v_total := coalesce(v_total, 0);
  v_used  := coalesce(v_used, 0);

  v_delta := coalesce(p_delta, p_new_total - v_total);
  if v_delta = 0 then raise exception 'NO_CHANGE' using errcode = 'P0001'; end if;
  v_after := v_total + v_delta;
  if v_after < v_used then raise exception 'BELOW_USED' using errcode = 'P0001'; end if;
  v_kind := case when p_new_total is not null then 'adjust' when v_delta > 0 then 'grant' else 'revoke' end;

  insert into public.training_credits (org_id, athlete_id, credit_category, total_credits)
  values (v_org, p_athlete, v_cat, v_after)
  on conflict (athlete_id, credit_category) do update
    set total_credits = excluded.total_credits, updated_at = now();

  insert into public.training_credit_adjustments
    (org_id, athlete_id, credit_category, kind, delta, total_before, total_after, used_at_time, reason, created_by)
  values (v_org, p_athlete, v_cat, v_kind, v_delta, v_total, v_after, v_used, btrim(p_reason), auth.uid());

  perform public.money_audit(v_org, 'CREDITS_ADJUSTED', 'training_credits', p_athlete,
    jsonb_build_object('category', p_category, 'total', v_total, 'used', v_used, 'balance', v_total - v_used),
    jsonb_build_object('category', p_category, 'total', v_after, 'used', v_used, 'balance', v_after - v_used,
                       'delta', v_delta, 'kind', v_kind, 'reason', btrim(p_reason)));

  return jsonb_build_object('athlete_id', p_athlete, 'category', p_category, 'total', v_after,
                            'used', v_used, 'balance', v_after - v_used, 'delta', v_delta);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11) Grants: client-callable RPCs for signed-in users (each checks the role
--     and org itself); internal helpers for nobody but the owner.
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.update_draft_invoice(uuid, jsonb)',
    'public.update_invoice_details(uuid, jsonb)',
    'public.issue_invoice_adjustment(uuid, text, numeric, text, text)',
    'public.void_invoice_adjustment(uuid, text)',
    'public.cancel_invoice(uuid, text)',
    'public.reopen_invoice(uuid, text)',
    'public.record_offline_payment(uuid, numeric, text, date, text, text)',
    'public.void_payment(uuid, text)',
    'public.edit_manual_payment(uuid, jsonb, text)',
    'public.annotate_payment(uuid, text)',
    'public.transfer_overpayment_to_credit(uuid, numeric, text)',
    'public.apply_family_credit(uuid, numeric, text)',
    'public.adjust_family_credit(uuid, text, numeric, text)',
    'public.adjust_training_credits(uuid, text, integer, integer, text)'
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

  foreach f in array array[
    'public.money_invoice_for_update(uuid)',
    'public.invoice_amount_due(uuid)',
    'public.refresh_invoice_adjustments(uuid)',
    'public.refresh_invoice_overdue(uuid)',
    'public.family_credit_balance(uuid, text)',
    'public.money_audit(uuid, text, text, uuid, jsonb, jsonb)',
    'public.invoice_money_snapshot(uuid)',
    'public.money_add_adjustment(public.invoices, text, numeric, text, text)',
    'public.money_void_payment(public.payments, text)'
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

-- recompute_invoice keeps its earlier grants (service role only); re-assert.
revoke all on function public.recompute_invoice(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.recompute_invoice(uuid) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.recompute_invoice(uuid) to service_role';
  end if;
end $$;
