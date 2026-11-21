-- ============================================================================
-- Sponsored players (additive, idempotent)
--
-- A club can sponsor a player so the family pays no (full) or a reduced
-- (partial) club fee: coaches' children, scholarship or company-sponsored
-- athletes. Nothing here is club-, sport- or country-specific.
--
-- 1. athletes.sponsorship_*            kind none | full | partial, percent
--                                      (full = 100), scope (season, recurring,
--                                      membership, camp, training, shop, all),
--                                      sponsor name, reason, from / until,
--                                      sponsored_by / sponsored_at (server-set).
-- 2. athlete_sponsorship_guard()       staff-only (admin / finance or the
--                                      service role): guardians keep their
--                                      write access to the other columns.
--                                      Normalises (full -> 100 %, none clears)
--                                      and stamps sponsored_by / sponsored_at.
--    athlete_sponsorship_audit()       audit_logs 'athlete.sponsorship.changed'.
-- 3. athlete_sponsorship_entries       ledger of the value given (reporting):
--                                      one row per sponsored invoice / waived
--                                      period / waived membership. Read: admin
--                                      and finance of the club; written only by
--                                      the functions below.
-- 4. Billing (consistent rule):
--      * the sponsored share is ALWAYS shown, never silently skipped: an
--        invoice line or credit note labelled "Sponsored (<sponsor>)" in the
--        invoice / club language, plus a ledger row;
--      * recurring fee periods and membership fees that are fully sponsored
--        issue NO invoice (period skipped 'sponsored' / membership active);
--        the ledger row records the value waived;
--      * other generated invoices (season / programme registrations, camps,
--        training, shop) get a credit note; when nothing is left to pay the
--        invoice is settled ('paid', zero balance: the activity / order /
--        membership it pays for is confirmed as for any paid invoice);
--      * dunning and autopay only chase the open balance (amount due minus
--        paid), which already excludes the sponsored share.
--    recurring_generate / membership_create  redefined with the sponsored line.
--    trg_invoices_sponsorship        deferred (end of transaction, after the
--                                    lines and totals exist): applies the
--                                    sponsorship to new / issued invoices.
--                                    Camp registrations and training packages
--                                    are applied by the server after member
--                                    prices (sponsorship_apply_service).
--    sponsorship_apply_open_invoices admin action for a player: cancels open
--                                    unpaid season / recurring invoices for a
--                                    full sponsorship, credit note otherwise.
-- 5. recompute_invoice: a settled zero-balance invoice stays 'paid'.
-- 6. anonymise_family clears sponsor name / reason.
--
-- RLS: athletes policies unchanged (row policies cover the new columns; the
-- guard in 2 blocks guardians). New table: org_id, RLS, restrictive tenant
-- isolation, select for admin / finance only, no client writes.
-- Tests: tests/db/sponsored_players.sql.
-- ============================================================================

-- 1) Athlete sponsorship columns ------------------------------------------------
alter table public.athletes add column if not exists sponsorship_kind    text not null default 'none';
alter table public.athletes add column if not exists sponsorship_percent numeric(5,2);
alter table public.athletes add column if not exists sponsorship_scope   text[] not null default '{season,recurring,membership}';
alter table public.athletes add column if not exists sponsor_name        text;
alter table public.athletes add column if not exists sponsorship_reason  text;
alter table public.athletes add column if not exists sponsorship_from    date;
alter table public.athletes add column if not exists sponsorship_until   date;
alter table public.athletes add column if not exists sponsored_by        uuid references public.profiles(id) on delete set null;
alter table public.athletes add column if not exists sponsored_at        timestamptz;

do $$ begin
  alter table public.athletes add constraint athletes_sponsorship_chk check (
    sponsorship_kind in ('none', 'full', 'partial')
    and (sponsorship_percent is null or (sponsorship_percent >= 1 and sponsorship_percent <= 100))
    and (sponsorship_kind <> 'partial' or sponsorship_percent is not null)
    and (sponsorship_kind <> 'full' or sponsorship_percent = 100)
    and (sponsorship_kind <> 'none' or sponsorship_percent is null)
    and sponsorship_scope <@ array['season', 'recurring', 'membership', 'camp', 'training', 'shop', 'all']::text[]
    and (sponsorship_kind = 'none' or cardinality(sponsorship_scope) >= 1)
    and (sponsor_name is null or char_length(sponsor_name) <= 120)
    and (sponsorship_reason is null or char_length(sponsorship_reason) <= 300)
    and (sponsorship_from is null or sponsorship_until is null or sponsorship_until >= sponsorship_from));
exception when duplicate_object then null; end $$;

create index if not exists idx_athletes_sponsored on public.athletes (org_id) where sponsorship_kind <> 'none';

comment on column public.athletes.sponsorship_kind is 'none | full | partial: the club pays all or part of this player''s club fees.';
comment on column public.athletes.sponsorship_percent is 'Share of the fee the sponsorship covers (1-100; full = 100).';
comment on column public.athletes.sponsorship_scope is 'Fees covered: season, recurring, membership, camp, training, shop, all.';
comment on column public.athletes.sponsor_name is 'Who sponsors (club, company, foundation), shown on invoices.';
comment on column public.athletes.sponsorship_reason is 'Internal reason (staff only in the UI).';
comment on column public.athletes.sponsored_by is 'Profile that last set the sponsorship (server-set).';

-- 2) Staff-only guard + audit ------------------------------------------------------
create or replace function public.athlete_sponsorship_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_staff boolean := public.is_service_caller() or public.is_finance();
begin
  if tg_op = 'INSERT' then
    if not v_staff then
      if new.sponsorship_kind <> 'none' or new.sponsorship_percent is not null or new.sponsor_name is not null
         or new.sponsorship_reason is not null or new.sponsorship_from is not null or new.sponsorship_until is not null then
        raise exception 'SPONSORSHIP_STAFF_ONLY' using errcode = '42501';
      end if;
      new.sponsorship_scope := '{season,recurring,membership}';
      new.sponsored_by := null; new.sponsored_at := null;
      return new;
    end if;
  elsif (new.sponsorship_kind, new.sponsorship_percent, new.sponsorship_scope, new.sponsor_name, new.sponsorship_reason,
         new.sponsorship_from, new.sponsorship_until)
        is not distinct from
        (old.sponsorship_kind, old.sponsorship_percent, old.sponsorship_scope, old.sponsor_name, old.sponsorship_reason,
         old.sponsorship_from, old.sponsorship_until) then
    -- Only the stamps changed: they are server-set, keep them.
    new.sponsored_by := old.sponsored_by; new.sponsored_at := old.sponsored_at;
    return new;
  elsif not v_staff then
    raise exception 'SPONSORSHIP_STAFF_ONLY' using errcode = '42501';
  end if;

  new.sponsor_name := nullif(btrim(new.sponsor_name), '');
  new.sponsorship_reason := nullif(btrim(new.sponsorship_reason), '');
  if new.sponsorship_kind = 'full' then
    new.sponsorship_percent := 100;
  elsif new.sponsorship_kind = 'none' then
    new.sponsorship_percent := null; new.sponsor_name := null; new.sponsorship_reason := null;
    new.sponsorship_from := null; new.sponsorship_until := null;
  end if;
  select coalesce(array_agg(distinct s order by s), '{}') into new.sponsorship_scope
    from unnest(coalesce(new.sponsorship_scope, '{}')) s;
  if new.sponsorship_kind = 'none' and cardinality(new.sponsorship_scope) = 0 then
    new.sponsorship_scope := '{season,recurring,membership}';
  end if;
  if tg_op = 'INSERT' and new.sponsorship_kind = 'none' then
    new.sponsored_by := null; new.sponsored_at := null;
  else
    new.sponsored_by := auth.uid(); new.sponsored_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_athlete_sponsorship_guard on public.athletes;
create trigger trg_athlete_sponsorship_guard
  before insert or update of sponsorship_kind, sponsorship_percent, sponsorship_scope, sponsor_name, sponsorship_reason,
                             sponsorship_from, sponsorship_until, sponsored_by, sponsored_at
  on public.athletes
  for each row execute function public.athlete_sponsorship_guard();

create or replace function public.athlete_sponsorship_json(a public.athletes)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object('kind', a.sponsorship_kind, 'percent', a.sponsorship_percent, 'scope', to_jsonb(a.sponsorship_scope),
                            'sponsor_name', a.sponsor_name, 'reason', a.sponsorship_reason,
                            'from', a.sponsorship_from, 'until', a.sponsorship_until);
$$;

create or replace function public.athlete_sponsorship_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.sponsorship_kind = 'none' then return new; end if;
  if tg_op = 'UPDATE' and public.athlete_sponsorship_json(new) is not distinct from public.athlete_sponsorship_json(old) then
    return new;
  end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (new.org_id, auth.uid(), 'athlete.sponsorship.changed', 'athletes', new.id,
          case when tg_op = 'UPDATE' then public.athlete_sponsorship_json(old) end,
          public.athlete_sponsorship_json(new));
  return new;
end $$;

drop trigger if exists trg_athlete_sponsorship_audit on public.athletes;
create trigger trg_athlete_sponsorship_audit
  after insert or update of sponsorship_kind, sponsorship_percent, sponsorship_scope, sponsor_name, sponsorship_reason,
                            sponsorship_from, sponsorship_until
  on public.athletes
  for each row execute function public.athlete_sponsorship_audit();

-- 3) Ledger of the value given ----------------------------------------------------
create table if not exists public.athlete_sponsorship_entries (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  athlete_id             uuid not null references public.athletes(id) on delete cascade,
  family_id              uuid references public.families(id) on delete set null,
  invoice_id             uuid references public.invoices(id) on delete set null,
  invoice_adjustment_id  uuid references public.invoice_adjustments(id) on delete set null,
  installment_id         uuid references public.payment_plan_installments(id) on delete set null,
  membership_id          uuid references public.memberships(id) on delete set null,
  scope                  text not null,
  method                 text not null,
  sponsorship_kind       text not null,
  percent                numeric(5,2) not null,
  sponsor_name           text,
  list_amount            numeric(12,2) not null,
  amount                 numeric(12,2) not null,
  currency               text not null,
  service_date           date not null,
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  voided_at              timestamptz,
  void_reason            text,
  constraint athlete_sponsorship_entries_chk check (
    scope in ('season', 'recurring', 'membership', 'camp', 'training', 'shop')
    and method in ('invoice_line', 'credit_note', 'cancellation', 'waived')
    and sponsorship_kind in ('full', 'partial')
    and percent > 0 and percent <= 100
    and amount > 0 and list_amount >= amount
    and currency ~ '^[A-Z]{3}$'
    and (sponsor_name is null or char_length(sponsor_name) <= 120)
    and coalesce(length(void_reason), 0) <= 500)
);
create index if not exists idx_sponsorship_entries_org on public.athlete_sponsorship_entries(org_id, service_date);
create index if not exists idx_sponsorship_entries_athlete on public.athlete_sponsorship_entries(athlete_id);
create index if not exists idx_sponsorship_entries_invoice on public.athlete_sponsorship_entries(invoice_id);
create unique index if not exists uq_sponsorship_entries_invoice_athlete
  on public.athlete_sponsorship_entries(invoice_id, athlete_id) where invoice_id is not null and voided_at is null;
create unique index if not exists uq_sponsorship_entries_installment
  on public.athlete_sponsorship_entries(installment_id) where installment_id is not null and voided_at is null;
create unique index if not exists uq_sponsorship_entries_membership
  on public.athlete_sponsorship_entries(membership_id) where membership_id is not null and invoice_id is null and voided_at is null;

drop trigger if exists trg_sponsorship_entries_updated on public.athlete_sponsorship_entries;
create trigger trg_sponsorship_entries_updated before update on public.athlete_sponsorship_entries
  for each row execute function public.set_updated_at();

create or replace function public.sponsorship_entries_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.athletes where id = new.athlete_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: athlete' using errcode = '42501';
  end if;
  if new.invoice_id is not null and not exists (select 1 from public.invoices where id = new.invoice_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: invoice' using errcode = '42501';
  end if;
  if new.family_id is not null and not exists (select 1 from public.families where id = new.family_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: family' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.amount, new.currency, new.athlete_id, new.org_id, new.invoice_id)
       is distinct from (old.amount, old.currency, old.athlete_id, old.org_id, old.invoice_id) then
    raise exception 'SPONSORSHIP_ENTRY_LOCKED' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_sponsorship_entries_same_org on public.athlete_sponsorship_entries;
create trigger trg_sponsorship_entries_same_org before insert or update on public.athlete_sponsorship_entries
  for each row execute function public.sponsorship_entries_same_org();

alter table public.athlete_sponsorship_entries enable row level security;
drop policy if exists sponsorship_entries_select on public.athlete_sponsorship_entries;
create policy sponsorship_entries_select on public.athlete_sponsorship_entries for select
  using (org_id = public.current_org_id() and public.is_finance());
drop policy if exists sponsorship_entries_no_insert on public.athlete_sponsorship_entries;
create policy sponsorship_entries_no_insert on public.athlete_sponsorship_entries for insert with check (false);
drop policy if exists sponsorship_entries_no_update on public.athlete_sponsorship_entries;
create policy sponsorship_entries_no_update on public.athlete_sponsorship_entries for update using (false) with check (false);
drop policy if exists sponsorship_entries_no_delete on public.athlete_sponsorship_entries;
create policy sponsorship_entries_no_delete on public.athlete_sponsorship_entries for delete using (false);
drop policy if exists platform_tenant_isolation on public.athlete_sponsorship_entries;
create policy platform_tenant_isolation on public.athlete_sponsorship_entries as restrictive for all
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.athlete_sponsorship_entries to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.athlete_sponsorship_entries to service_role;
  end if;
end $$;

-- 4) Billing helpers ------------------------------------------------------------------
-- Share (0-100) of a fee in p_scope on p_on that the player's sponsorship covers.
-- Mirrors sponsorshipPercent() in src/lib/pricing/sponsorship.ts.
create or replace function public.athlete_sponsorship_percent(a public.athletes, p_scope text, p_on date)
returns numeric
language sql
stable
set search_path = public
as $$
  select case
    when a.id is null or a.sponsorship_kind is null or a.sponsorship_kind = 'none' then 0
    when not (p_scope = any(a.sponsorship_scope) or 'all' = any(a.sponsorship_scope)) then 0
    when a.sponsorship_from is not null and p_on < a.sponsorship_from then 0
    when a.sponsorship_until is not null and p_on > a.sponsorship_until then 0
    when a.sponsorship_kind = 'full' then 100
    else least(greatest(coalesce(a.sponsorship_percent, 0), 0), 100)
  end::numeric;
$$;

-- Invoice line / credit note label in the invoice (or club) language.
create or replace function public.sponsorship_label(p_org uuid, p_locale text, p_sponsor text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_lang text; v_word text;
begin
  v_lang := lower(left(coalesce(nullif(p_locale, ''), (select default_locale from public.organizations where id = p_org), 'en'), 2));
  v_word := case v_lang when 'fr' then 'Sponsorisé' when 'de' then 'Gesponsert' when 'it' then 'Sponsorizzato'
                        when 'es' then 'Patrocinado' else 'Sponsored' end;
  return left(v_word || coalesce(' (' || nullif(btrim(p_sponsor), '') || ')', ''), 200);
end $$;

-- What an invoice pays for, in sponsorship terms (null = not a club fee).
create or replace function public.sponsorship_invoice_scope(p_invoice uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v public.invoices;
begin
  select * into v from public.invoices where id = p_invoice;
  if not found then return null; end if;
  if to_regclass('public.shop_orders') is not null
     and exists (select 1 from public.shop_orders where invoice_id = p_invoice) then return 'shop'; end if;
  if (to_regclass('public.training_package_purchases') is not null
      and exists (select 1 from public.training_package_purchases where invoice_id = p_invoice))
     or exists (select 1 from public.training_bookings where invoice_id = p_invoice) then return 'training'; end if;
  if exists (select 1 from public.registrations where invoice_id = p_invoice and camp_edition_id is not null) then return 'camp'; end if;
  if exists (select 1 from public.payment_plan_installments i join public.payment_plans p on p.id = i.plan_id
              where i.invoice_id = p_invoice and p.kind = 'recurring') then return 'recurring'; end if;
  if exists (select 1 from public.memberships where invoice_id = p_invoice) then return 'membership'; end if;
  if v.program_id is not null then
    return case when (select kind::text from public.programs where id = v.program_id) = 'camp' then 'camp' else 'season' end;
  end if;
  return null;
end $$;

-- Players an invoice is for, with the part of the invoice that is theirs.
-- One player: the whole invoice total. Several (a family basket): each
-- player's registration price snapshot.
create or replace function public.sponsorship_invoice_athletes(p_invoice uuid)
returns table (athlete_id uuid, base numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v public.invoices; v_ids uuid[];
begin
  select * into v from public.invoices where id = p_invoice;
  if not found then return; end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from (
    select r.athlete_id as x from public.registrations r where r.invoice_id = p_invoice or r.id = v.registration_id
    union all select v.athlete_id where v.athlete_id is not null
    union all select tp.athlete_id from public.training_package_purchases tp
               where to_regclass('public.training_package_purchases') is not null and tp.invoice_id = p_invoice
  ) s where x is not null;
  if cardinality(v_ids) = 1 then
    athlete_id := v_ids[1]; base := greatest(coalesce(v.total_chf, 0), 0); return next;
  elsif cardinality(v_ids) > 1 then
    return query
      select r.athlete_id, sum(coalesce(r.price_amount, 0))::numeric
        from public.registrations r
       where (r.invoice_id = p_invoice or r.id = v.registration_id) and r.athlete_id = any(v_ids)
       group by r.athlete_id;
  end if;
end $$;

-- Apply the sponsorship of every sponsored player on one invoice.
--   p_mode 'auto'   generation: credit note; nothing left -> settled ('paid').
--   p_mode 'admin'  admin action: a fully sponsored, unpaid season / recurring
--                   invoice is cancelled (reason); otherwise as 'auto'.
-- Idempotent per (invoice, player). p_dry_run: compute only.
create or replace function public.sponsorship_apply_internal(p_invoice uuid, p_mode text default 'auto', p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v        public.invoices;
  a        public.athletes;
  r        record;
  v_scope  text;
  v_on     date;
  v_exp    int;
  v_pct    numeric;
  v_amt    numeric;
  v_due    numeric;
  v_paid   numeric;
  v_open   numeric;
  v_label  text;
  v_adj    uuid;
  v_method text;
  v_total  numeric := 0;
  v_lines  jsonb := '[]'::jsonb;
  v_cancel boolean := false;
begin
  select * into v from public.invoices where id = p_invoice for update;
  if not found or v.status::text not in ('pending', 'sent', 'partially_paid', 'overdue') then
    return jsonb_build_object('invoice_id', p_invoice, 'amount', 0, 'lines', v_lines);
  end if;
  v_scope := public.sponsorship_invoice_scope(v.id);
  if v_scope is null then return jsonb_build_object('invoice_id', v.id, 'amount', 0, 'lines', v_lines); end if;
  v_on := coalesce(public.invoice_activity_start(v.id), v.issued_at::date, current_date);
  v_exp := public.currency_exponent(v.currency);

  for r in select * from public.sponsorship_invoice_athletes(v.id) loop
    select * into a from public.athletes where id = r.athlete_id and org_id = v.org_id;
    continue when a.id is null;
    v_pct := public.athlete_sponsorship_percent(a, v_scope, v_on);
    continue when v_pct <= 0;
    continue when exists (select 1 from public.athlete_sponsorship_entries e
                           where e.invoice_id = v.id and e.athlete_id = a.id and e.voided_at is null);
    v_due := coalesce(v.total_chf, 0) + coalesce(v.adjustments_total, 0);
    v_paid := public.invoice_net_paid(v.id);
    v_open := v_due - v_paid;
    exit when v_open <= 0;
    v_amt := least(round(coalesce(r.base, 0) * v_pct / 100, v_exp), v_open);
    continue when v_amt <= 0;
    v_label := public.sponsorship_label(v.org_id, v.locale, a.sponsor_name);
    v_cancel := p_mode = 'admin' and v_pct >= 100 and v_scope in ('season', 'recurring')
                and v_paid <= 0 and v_amt >= v_due;
    v_method := case when v_cancel then 'cancellation' else 'credit_note' end;
    v_lines := v_lines || jsonb_build_object('athlete_id', a.id, 'percent', v_pct, 'amount', v_amt,
                                             'method', v_method, 'label', v_label, 'scope', v_scope);
    v_total := v_total + v_amt;
    if not p_dry_run then
      v_adj := public.money_add_adjustment(v, case when v_cancel then 'cancellation' else 'credit_note' end,
                                           v_amt, 'sponsorship', v_label);
      insert into public.athlete_sponsorship_entries
        (org_id, athlete_id, family_id, invoice_id, invoice_adjustment_id, scope, method, sponsorship_kind, percent,
         sponsor_name, list_amount, amount, currency, service_date, created_by)
      values (v.org_id, a.id, v.family_id, v.id, v_adj, v_scope, v_method, a.sponsorship_kind, v_pct,
              a.sponsor_name, greatest(coalesce(r.base, 0), v_amt), v_amt, v.currency, v_on, auth.uid());
      if v_cancel then
        update public.invoices
           set status = 'cancelled', cancelled_at = now(), cancel_reason = left(v_label, 500), paid_at = null
         where id = v.id;
      end if;
      select * into v from public.invoices where id = v.id;
    end if;
    exit when v_cancel;
  end loop;

  if v_total > 0 and not p_dry_run then
    if v.status::text <> 'cancelled' then
      perform public.recompute_invoice(v.id);
      if public.invoice_amount_due(v.id) - public.invoice_net_paid(v.id) <= 0
         and (select status::text from public.invoices where id = v.id) in ('pending', 'sent', 'overdue') then
        -- Nothing left to pay: settled by the sponsorship (zero balance).
        update public.invoices set status = 'paid', paid_at = coalesce(paid_at, now()) where id = v.id;
      else
        perform public.refresh_invoice_overdue(v.id);
      end if;
    end if;
    perform public.money_audit(v.org_id, 'SPONSORSHIP_APPLIED', 'invoices', v.id, null,
      jsonb_build_object('amount', v_total, 'currency', v.currency, 'mode', p_mode, 'lines', v_lines));
  end if;
  return jsonb_build_object('invoice_id', v.id, 'number', v.number, 'currency', v.currency, 'amount', v_total,
                            'lines', v_lines);
end $$;

-- Server (service role): apply after a flow that adjusts prices after the
-- RPC (camp member prices, training packages).
create or replace function public.sponsorship_apply_service(p_invoice uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return public.sponsorship_apply_internal(p_invoice, 'auto', false);
end $$;

-- Deferred invoice trigger: at the end of the creating transaction (lines
-- and totals exist), apply sponsorship to issued invoices. Camp
-- registrations and training packages wait for member prices (server).
-- Never fails the creating transaction.
create or replace function public.invoices_sponsorship_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_msg text;
begin
  if not exists (select 1 from public.athletes where org_id = new.org_id and sponsorship_kind <> 'none') then
    return null;
  end if;
  if exists (select 1 from public.registrations where invoice_id = new.id and camp_edition_id is not null)
     or (to_regclass('public.training_package_purchases') is not null
         and exists (select 1 from public.training_package_purchases where invoice_id = new.id)) then
    return null;
  end if;
  begin
    perform public.sponsorship_apply_internal(new.id, 'auto', false);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
    values (new.org_id, auth.uid(), 'SPONSORSHIP_APPLY_FAILED', 'invoices', new.id, jsonb_build_object('error', left(v_msg, 300)));
  end;
  return null;
end $$;

drop trigger if exists trg_invoices_sponsorship on public.invoices;
create constraint trigger trg_invoices_sponsorship
  after insert or update of status on public.invoices
  deferrable initially deferred
  for each row
  when (new.status::text in ('pending', 'sent', 'partially_paid', 'overdue'))
  execute function public.invoices_sponsorship_apply();

-- Admin action on a player: apply the sponsorship to the open invoices that
-- were issued before it was set. p_dry_run = preview for the confirmation.
create or replace function public.sponsorship_apply_open_invoices(p_athlete uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a        public.athletes;
  r        record;
  v_res    jsonb;
  v_out    jsonb := '[]'::jsonb;
  n        int := 0;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into a from public.athletes where id = p_athlete and org_id = public.current_org_id();
  if not found then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  if a.sponsorship_kind = 'none' then raise exception 'NOT_SPONSORED' using errcode = 'P0001'; end if;

  for r in
    select distinct i.id, i.issued_at from public.invoices i
     where i.org_id = a.org_id and i.family_id = a.family_id
       and i.status::text in ('pending', 'sent', 'partially_paid', 'overdue')
       and (i.athlete_id = a.id
            or exists (select 1 from public.registrations g where g.athlete_id = a.id and (g.invoice_id = i.id or g.id = i.registration_id))
            or (to_regclass('public.training_package_purchases') is not null
                and exists (select 1 from public.training_package_purchases tp where tp.athlete_id = a.id and tp.invoice_id = i.id)))
     order by i.issued_at, i.id
  loop
    v_res := public.sponsorship_apply_internal(r.id, 'admin', p_dry_run);
    if coalesce((v_res->>'amount')::numeric, 0) > 0 then
      n := n + 1;
      v_out := v_out || jsonb_build_object('invoice_id', r.id, 'number', v_res->>'number', 'currency', v_res->>'currency',
        'amount', (v_res->>'amount')::numeric,
        'method', (select l->>'method' from jsonb_array_elements(v_res->'lines') l where (l->>'athlete_id')::uuid = a.id limit 1));
    end if;
  end loop;

  if not p_dry_run then
    perform public.money_audit(a.org_id, 'SPONSORSHIP_APPLIED_TO_OPEN_INVOICES', 'athletes', a.id, null,
      jsonb_build_object('invoices', n, 'lines', v_out));
  end if;
  return jsonb_build_object('athlete_id', a.id, 'invoices', n, 'lines', v_out, 'dry_run', p_dry_run);
end $$;

-- 5) recompute_invoice: a settled zero-balance invoice stays 'paid' -------------
-- Body from 20250420095900_money_editing.sql; only the v_paid <= 0 branch differs.
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
    if v_total <= 0 and v_cur::text = 'paid' then
      null;  -- settled without a payment (e.g. fully sponsored): stays paid
    elsif v_cur::text in ('paid', 'partially_paid', 'written_off') then
      update public.invoices set status = 'sent', paid_at = null where id = p_invoice;
    end if;
  elsif v_paid < v_total then
    update public.invoices set status = 'partially_paid', paid_at = null where id = p_invoice;
  else
    update public.invoices set status = 'paid', paid_at = coalesce(paid_at, now()) where id = p_invoice;
  end if;

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

-- 4b) recurring_generate with the sponsored share --------------------------------
-- Body from 20250420101000_instalments_recurring_autopay.sql plus: the
-- player's sponsorship (scope 'recurring', on the period start) is taken off
-- after the other discounts as its own line; a fully sponsored period issues
-- no invoice (instalment skipped 'sponsored', action 'skip_sponsored'); the
-- ledger records the value either way. `discount` includes the sponsored part.
create or replace function public.recurring_generate(p_org uuid, p_as_of date default current_date, p_dry_run boolean default false)
returns table (plan_id uuid, family_id uuid, athlete_id uuid, period_start date, period_end date,
               amount numeric, discount numeric, net numeric, action text, installment_id uuid, invoice_id uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_plan    public.payment_plans%rowtype;
  t         public.recurring_fee_templates%rowtype;
  v_ath     public.athletes%rowtype;
  v_period  date;
  v_end     date;
  v_next    date;
  v_loops   int;
  v_seq     int;
  v_amount  numeric;
  v_disc    jsonb;
  v_dval    numeric;
  v_spct    numeric;
  v_spon    numeric;
  v_slabel  text;
  v_net     numeric;
  v_number  text;
  v_invoice uuid;
  v_inst    uuid;
  v_kind    text;
  b         record;
begin
  if not (public.is_service_caller() or public.is_finance_of(p_org)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  for v_plan in
    select * from public.payment_plans pp
     where pp.org_id = p_org and pp.kind = 'recurring' and pp.status = 'active'
       and pp.next_run_date is not null and pp.next_run_date <= p_as_of
     order by pp.created_at
     for update skip locked
  loop
    t := null;
    if v_plan.template_id is not null then
      select * into t from public.recurring_fee_templates where id = v_plan.template_id;
    end if;
    v_ath := null;
    if v_plan.athlete_id is not null then
      select * into v_ath from public.athletes x where x.id = v_plan.athlete_id and x.org_id = p_org;
    end if;
    v_loops := 0;
    v_period := v_plan.next_run_date;
    while v_period <= p_as_of and (v_plan.end_date is null or v_period <= v_plan.end_date) and v_loops < 12 loop
      if t.id is not null then
        select * into b from public.recurring_period_bounds(t.start_date, t.billing_day, t.frequency, v_period);
        v_end := b.period_end;
      else
        v_end := (v_period + public.plan_interval(v_plan.frequency, v_plan.interval_count))::date - 1;
      end if;
      v_next := v_end + 1;

      if exists (select 1 from public.payment_plan_installments x where x.plan_id = v_plan.id and x.period_start = v_period) then
        null;  -- already generated or skipped
      else
        v_kind := null;
        select x.kind into v_kind from public.recurring_plan_pauses x
         where x.plan_id = v_plan.id and x.starts_on <= v_period and x.ends_on >= v_period
         order by x.starts_on limit 1;
        v_amount := v_plan.amount_per_period;
        if t.id is not null then
          v_amount := public.recurring_prorate(v_amount, v_period, v_end, v_plan.start_date, t.proration, v_plan.currency);
        end if;
        v_disc := case when t.id is null or t.apply_discounts then public.recurring_discount(v_plan, v_amount, v_period)
                       else jsonb_build_object('amount', 0) end;
        v_dval := coalesce((v_disc->>'amount')::numeric, 0);
        v_spct := public.athlete_sponsorship_percent(v_ath, 'recurring', v_period);
        v_spon := case when v_spct > 0 and v_amount - v_dval > 0
                       then least(round((v_amount - v_dval) * v_spct / 100, public.currency_exponent(v_plan.currency)), v_amount - v_dval)
                       else 0 end;
        v_net := v_amount - v_dval - v_spon;

        plan_id := v_plan.id; family_id := v_plan.family_id; athlete_id := v_plan.athlete_id;
        period_start := v_period; period_end := v_end;
        amount := v_amount; discount := v_dval + v_spon; net := v_net;
        installment_id := null; invoice_id := null;

        if v_kind is not null or v_net <= 0 then
          action := case when v_kind is not null then 'skip_pause' when v_spon > 0 then 'skip_sponsored' else 'skip_zero' end;
          if not p_dry_run then
            select coalesce(max(x.seq), 0) + 1 into v_seq from public.payment_plan_installments x where x.plan_id = v_plan.id;
            insert into public.payment_plan_installments (org_id, plan_id, seq, due_date, amount, currency, status,
                                                          period_start, period_end, skipped_reason)
            values (p_org, v_plan.id, v_seq, v_period, 0, v_plan.currency, 'skipped', v_period, v_end,
                    case when v_kind is not null then 'pause:' || v_kind when v_spon > 0 then 'sponsored' else 'zero' end)
            returning id into v_inst;
            installment_id := v_inst;
            if v_kind is null and v_spon > 0 then
              insert into public.athlete_sponsorship_entries
                (org_id, athlete_id, family_id, installment_id, scope, method, sponsorship_kind, percent, sponsor_name,
                 list_amount, amount, currency, service_date, created_by)
              values (p_org, v_ath.id, v_plan.family_id, v_inst, 'recurring', 'waived', v_ath.sponsorship_kind, v_spct,
                      v_ath.sponsor_name, v_amount - v_dval, v_spon, upper(v_plan.currency), v_period, auth.uid());
            end if;
          end if;
        else
          action := 'invoice';
          if not p_dry_run then
            select coalesce(max(x.seq), 0) + 1 into v_seq from public.payment_plan_installments x where x.plan_id = v_plan.id;
            v_number := public.next_invoice_number(p_org);
            insert into public.invoices (org_id, number, family_id, athlete_id, program_id, description, status, due_date, currency)
            values (p_org, v_number, v_plan.family_id, v_plan.athlete_id, v_plan.program_id,
                    coalesce(v_plan.description, 'Membership fee') || ' · ' || to_char(v_period, 'YYYY-MM-DD') || ' – ' || to_char(v_end, 'YYYY-MM-DD'),
                    'sent', v_period + v_plan.due_days, v_plan.currency)
            returning id into v_invoice;
            insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
            values (p_org, v_invoice, coalesce(v_plan.description, 'Membership fee'), 1, v_amount, v_amount);
            if v_dval > 0 then
              insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
              values (p_org, v_invoice, coalesce(v_disc->>'label', 'Discount'), 1, -v_dval, -v_dval);
            end if;
            if v_spon > 0 then
              v_slabel := public.sponsorship_label(p_org, null, v_ath.sponsor_name);
              insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
              values (p_org, v_invoice, v_slabel, 1, -v_spon, -v_spon);
            end if;
            update public.invoices set total_chf = v_net where id = v_invoice;
            insert into public.payment_plan_installments (org_id, plan_id, seq, due_date, amount, currency, invoice_id, status,
                                                          period_start, period_end)
            values (p_org, v_plan.id, v_seq, v_period + v_plan.due_days, v_net, v_plan.currency, v_invoice, 'invoiced', v_period, v_end)
            returning id into v_inst;
            installment_id := v_inst; invoice_id := v_invoice;
            if v_spon > 0 then
              insert into public.athlete_sponsorship_entries
                (org_id, athlete_id, family_id, invoice_id, installment_id, scope, method, sponsorship_kind, percent, sponsor_name,
                 list_amount, amount, currency, service_date, created_by)
              values (p_org, v_ath.id, v_plan.family_id, v_invoice, v_inst, 'recurring', 'invoice_line', v_ath.sponsorship_kind, v_spct,
                      v_ath.sponsor_name, v_amount - v_dval, v_spon, upper(v_plan.currency), v_period, auth.uid());
            end if;
          end if;
        end if;
        return next;
      end if;

      v_loops := v_loops + 1;
      v_period := v_next;
    end loop;

    if not p_dry_run then
      update public.payment_plans pp
         set next_run_date = v_period,
             status = case when v_plan.end_date is not null and v_period > v_plan.end_date then 'completed' else pp.status end
       where pp.id = v_plan.id;
    end if;
  end loop;
end;
$$;

-- 4c) membership_create with the sponsored share -----------------------------------
-- Body from 20250420101500_club_admin.sql plus: a person membership of a
-- sponsored player (scope 'membership', on valid_from) gets a sponsored line;
-- fully sponsored = active at once, no invoice; the ledger records the value.
-- price_amount holds what the family pays; 'sponsored' is returned too.
create or replace function public.membership_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid := nullif(p_payload->>'org_id', '')::uuid;
  v_type     public.membership_types;
  v_prev     public.memberships;
  v_ath      public.athletes;
  v_family   uuid;
  v_athlete  uuid := nullif(p_payload->>'athlete_id', '')::uuid;
  v_dob      date;
  v_age      int;
  v_from     date;
  v_until    date;
  v_today    date;
  v_currency text;
  v_exp      int;
  v_list     numeric;
  v_price    numeric;
  v_spct     numeric := 0;
  v_spon     numeric := 0;
  v_free     boolean := coalesce((p_payload->>'free')::boolean, false);
  v_due      int := least(greatest(coalesce((p_payload->>'due_days')::int, 30), 0), 120);
  v_invoice  uuid;
  v_invnum   text;
  v_id       uuid;
  v_by       uuid := nullif(p_payload->>'created_by', '')::uuid;
  v_name     text;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if v_org is null then raise exception 'ORG_REQUIRED' using errcode = 'P0001'; end if;
  v_today := public.ca_org_today(v_org);

  if nullif(p_payload->>'renew_from_id', '') is not null then
    select * into v_prev from public.memberships
     where id = (p_payload->>'renew_from_id')::uuid and org_id = v_org for update;
    if not found then raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002'; end if;
    if v_prev.status = 'cancelled' then raise exception 'MEMBERSHIP_CANCELLED' using errcode = 'P0001'; end if;
    if exists (select 1 from public.memberships where renewed_from_id = v_prev.id and status <> 'cancelled') then
      raise exception 'ALREADY_RENEWED' using errcode = 'P0001';
    end if;
    v_family := v_prev.family_id;
    v_athlete := v_prev.athlete_id;
    select * into v_type from public.membership_types
     where id = coalesce(nullif(p_payload->>'type_id', '')::uuid, v_prev.membership_type_id) and org_id = v_org;
    v_from := greatest(v_prev.valid_until + 1, (select period_start from public.membership_period(v_type.period, v_type.season_start_month, v_today)));
  else
    select * into v_type from public.membership_types where id = nullif(p_payload->>'type_id', '')::uuid and org_id = v_org;
    select id into v_family from public.families where id = nullif(p_payload->>'family_id', '')::uuid and org_id = v_org;
    v_from := coalesce(nullif(p_payload->>'valid_from', '')::date, v_today);
  end if;
  if v_type.id is null then raise exception 'TYPE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not v_type.is_active then raise exception 'TYPE_INACTIVE' using errcode = 'P0001'; end if;
  if v_family is null then raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_type.scope = 'person' then
    if v_athlete is null then raise exception 'ATHLETE_REQUIRED' using errcode = 'P0001'; end if;
    select dob, btrim(first_name || ' ' || last_name) into v_dob, v_name
      from public.athletes where id = v_athlete and family_id = v_family and org_id = v_org;
    if not found then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
    v_age := extract(year from age(v_from, v_dob))::int;
    if (v_type.min_age is not null and v_age < v_type.min_age) or (v_type.max_age is not null and v_age > v_type.max_age) then
      raise exception 'AGE_OUT_OF_RANGE' using errcode = 'P0001';
    end if;
    select * into v_ath from public.athletes where id = v_athlete;
  else
    v_athlete := null;
    select name into v_name from public.families where id = v_family;
  end if;

  select period_end into v_until from public.membership_period(v_type.period, v_type.season_start_month, v_from);

  if exists (select 1 from public.memberships m
              where m.org_id = v_org and m.family_id = v_family and m.membership_type_id = v_type.id
                and m.athlete_id is not distinct from v_athlete and m.status in ('active', 'pending_payment')
                and daterange(m.valid_from, m.valid_until, '[]') && daterange(v_from, v_until, '[]')) then
    raise exception 'ALREADY_MEMBER' using errcode = 'P0001';
  end if;

  v_currency := upper(coalesce(v_type.currency, public.org_currency(v_org)));
  v_exp := public.currency_exponent(v_currency);
  v_list := case when v_free then 0 else round(v_type.price, v_exp) end;
  if v_list > 0 and v_ath.id is not null then
    v_spct := public.athlete_sponsorship_percent(v_ath, 'membership', v_from);
    v_spon := least(round(v_list * v_spct / 100, v_exp), v_list);
  end if;
  v_price := v_list - v_spon;

  insert into public.memberships (org_id, membership_type_id, family_id, athlete_id, valid_from, valid_until, status,
                                  price_amount, currency, renewed_from_id, created_by)
  values (v_org, v_type.id, v_family, v_athlete, v_from, v_until,
          case when v_price > 0 then 'pending_payment' else 'active' end,
          v_price, v_currency, v_prev.id, v_by)
  returning id into v_id;

  if v_price > 0 then
    v_invnum := public.next_invoice_number(v_org);
    insert into public.invoices (org_id, number, family_id, athlete_id, description, status, due_date, currency, total_chf, created_by)
    values (v_org, v_invnum, v_family, v_athlete, left(v_type.name, 500), 'sent', v_today + v_due, v_currency, v_price, v_by)
    returning id into v_invoice;
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (v_org, v_invoice, left(v_type.name || ' — ' || coalesce(v_name, '') || ' — '
                                   || to_char(v_from, 'DD.MM.YYYY') || '–' || to_char(v_until, 'DD.MM.YYYY'), 500),
            1, v_list, v_list);
    if v_spon > 0 then
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (v_org, v_invoice, public.sponsorship_label(v_org, null, v_ath.sponsor_name), 1, -v_spon, -v_spon);
    end if;
    update public.memberships set invoice_id = v_invoice where id = v_id;
  end if;

  if v_spon > 0 then
    insert into public.athlete_sponsorship_entries
      (org_id, athlete_id, family_id, invoice_id, membership_id, scope, method, sponsorship_kind, percent, sponsor_name,
       list_amount, amount, currency, service_date, created_by)
    values (v_org, v_ath.id, v_family, v_invoice, v_id, 'membership',
            case when v_invoice is null then 'waived' else 'invoice_line' end,
            v_ath.sponsorship_kind, v_spct, v_ath.sponsor_name, v_list, v_spon, v_currency, v_from, v_by);
  end if;

  perform public.ca_audit(v_org, case when v_prev.id is null then 'membership.join' else 'membership.renew' end,
                          'memberships', v_id, jsonb_build_object('type_id', v_type.id, 'invoice_id', v_invoice, 'by', v_by,
                                                                  'sponsored', v_spon));

  return jsonb_build_object('membership_id', v_id, 'invoice_id', v_invoice, 'invoice_number', v_invnum,
                            'amount', v_price, 'sponsored', v_spon, 'currency', v_currency, 'valid_from', v_from, 'valid_until', v_until,
                            'family_id', v_family, 'athlete_id', v_athlete);
end;
$$;

-- 6) Erasure also clears the sponsor name / reason -----------------------------------
create or replace function public.athletes_clear_sponsorship_on_erasure()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- anonymise_family sets first_name 'Redacted' / last_name 'Athlete'.
  if new.first_name = 'Redacted' and new.last_name = 'Athlete' and new.dob = '1900-01-01'
     and (old.first_name, old.last_name) is distinct from (new.first_name, new.last_name) then
    new.sponsor_name := null;
    new.sponsorship_reason := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_athletes_sponsorship_erasure on public.athletes;
create trigger trg_athletes_sponsorship_erasure
  before update of first_name, last_name on public.athletes
  for each row execute function public.athletes_clear_sponsorship_on_erasure();

-- 7) Grants ---------------------------------------------------------------------------
-- Internal SECURITY DEFINER helpers: no client may call them. The admin
-- action is for signed-in staff (it checks is_finance() itself); the service
-- apply is for the server only.
do $$
declare f text;
begin
  foreach f in array array[
    'public.sponsorship_apply_internal(uuid, text, boolean)', 'public.sponsorship_apply_service(uuid)',
    'public.sponsorship_apply_open_invoices(uuid, boolean)', 'public.sponsorship_invoice_athletes(uuid)',
    'public.sponsorship_invoice_scope(uuid)', 'public.sponsorship_label(uuid, text, text)',
    'public.invoices_sponsorship_apply()', 'public.sponsorship_entries_same_org()', 'public.athlete_sponsorship_audit()'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.sponsorship_apply_open_invoices(uuid, boolean) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.sponsorship_apply_service(uuid) to service_role';
    execute 'grant execute on function public.sponsorship_apply_open_invoices(uuid, boolean) to service_role';
  end if;
end $$;
