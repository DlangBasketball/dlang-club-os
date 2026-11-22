-- ============================================================================
-- Selection programmes: roster, tournaments, fee arrangements (additive,
-- idempotent; existing data is preserved)
--
-- Builds on 20250420102600_selection_programs.sql. Nothing here is club-,
-- sport- or country-specific: a club configures tournaments, packages and
-- monthly amounts as data.
--
-- 0. FIX: enrolment never wrote the programme registration.
--    selection_enroll_internal inserted into registrations with
--    `on conflict (athlete_id, program_id)`, but registrations only has
--    PARTIAL unique indexes since 20250420100100_camps_discounts.sql
--    (registrations_athlete_program_uidx ... where camp_edition_id is null).
--    Postgres raised "there is no unique or exclusion constraint matching the
--    ON CONFLICT specification" on every enrolment; the exception handler
--    swallowed it (audit action 'selection.registration_skipped'), so
--    enrolled players were missing from programme registrations / rosters.
--    Also, a payment arriving after the registration window closed (or from
--    the payment webhook, which is not finance) would have been refused by
--    registrations_program_rules: selection enrolment now bypasses the
--    public registration rules (the application is the gate).
--    Now: the conflict target names the partial index predicate; a failure
--    is still not allowed to roll back a payment, but it is logged
--    ('selection.registration_failed', WARNING) AND surfaced to staff by
--    selection_roster_health (derived: enrolled applications without a
--    confirmed registration). Every enrolled application is backfilled
--    below (idempotent).
-- 1. Programme series / coach payment-status setting; package tournament
--    count and monthly amount.
-- 2. Fee arrangement snapshot on the application (agreed fee, currency,
--    kind full / monthly, monthly amount, first due date, instalment count,
--    tournaments covered, agreed at / by). Later package price changes never
--    change it. Withdrawal reason / by / balance at withdrawal.
-- 3. program_tournaments (stages of a programme) and application_tournaments
--    (which tournaments an enrolment covers; covered / withdrawn).
-- 4. Money summary derived from invoices, adjustments, payments and plan
--    instalments (no stored balance): selection_invoice_summary.
-- 5. Staff RPCs (SECURITY DEFINER, role and org checked in SQL):
--      selection_staff_add          admin: add a player from the directory
--      selection_set_arrangement    finance: fee arrangement (re-issue before
--                                   any payment; credit / debit note with a
--                                   reason after)
--      selection_set_tournaments    admin: tournaments covered (count must
--                                   match the package unless overridden
--                                   with a reason)
--      selection_withdraw_tournament admin: one tournament
--      selection_withdraw_enrollment admin: keeps invoice, payments, plan
--      selection_update_enrollment  admin: division, jersey, notes, status
--      selection_move_enrollment    admin: other season / programme (only
--                                   without payments)
--    Reads: selection_roster (finance: money; assigned coaches: no amounts,
--    payment status only when the programme allows it),
--    selection_athlete_enrollments (athlete profile; money for finance and
--    the athlete's guardians), selection_roster_health (staff notice).
--
-- Tests: tests/db/selection_roster.sql.
-- ============================================================================

-- 0a) Registration rules: selection enrolment is gated by the application.
-- Body from 20250420095800_club_ops_admin_edit.sql plus the first branch.
create or replace function public.registrations_program_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p    public.programs%rowtype;
  v_dob  date;
  v_ref  date;
  v_age  int;
begin
  if coalesce(current_setting('app.selection_enroll', true), '') = 'on' then
    return new;
  end if;
  if public.current_org_id() is not distinct from new.org_id and public.is_finance() then
    return new;
  end if;
  select * into v_p from public.programs where id = new.program_id;
  if not found then return new; end if; -- FK reports it

  if v_p.status <> 'published' then
    raise exception 'PROGRAM_NOT_OPEN' using errcode = 'P0001';
  end if;
  if (v_p.registration_opens_at is not null and now() < v_p.registration_opens_at)
     or (v_p.registration_closes_at is not null and now() >= v_p.registration_closes_at) then
    raise exception 'REGISTRATION_CLOSED' using errcode = 'P0001';
  end if;
  if v_p.min_age is not null or v_p.max_age is not null then
    select dob into v_dob from public.athletes where id = new.athlete_id;
    if v_dob is not null then
      v_ref := greatest(coalesce(v_p.starts_on, current_date), current_date);
      v_age := extract(year from age(v_ref, v_dob))::int;
      if (v_p.min_age is not null and v_age < v_p.min_age)
         or (v_p.max_age is not null and v_age > v_p.max_age) then
        raise exception 'AGE_OUT_OF_RANGE' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- 0b) Confirmed programme registration for an enrolled application.
-- Returns false (and logs) on failure: a payment must never roll back
-- because of the roster; selection_roster_health shows the gap to staff.
create or replace function public.selection_ensure_registration(p_application uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  a       public.program_applications;
  v_state text;
  v_msg   text;
begin
  select * into a from public.program_applications where id = p_application;
  if not found or a.status <> 'enrolled' then return false; end if;
  perform set_config('app.selection_enroll', 'on', true);
  begin
    insert into public.registrations (org_id, athlete_id, program_id, status, invoice_id)
    values (a.org_id, a.athlete_id, a.program_id, 'confirmed', a.invoice_id)
    on conflict (athlete_id, program_id) where camp_edition_id is null
    do update set status = 'confirmed'
      where public.registrations.status is distinct from 'confirmed';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    perform set_config('app.selection_enroll', 'off', true);
    raise warning 'selection_ensure_registration(%): % %', a.id, v_state, v_msg;
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
    values (a.org_id, auth.uid(), 'selection.registration_failed', 'program_applications', a.id,
            jsonb_build_object('error', left(v_msg, 300), 'sqlstate', v_state, 'program_id', a.program_id,
                               'athlete_id', a.athlete_id));
    return false;
  end;
  perform set_config('app.selection_enroll', 'off', true);
  return true;
end $$;

-- 0c) Enrolment: status, team roster of the division, programme registration.
create or replace function public.selection_enroll_internal(p_application uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare a public.program_applications; v_team uuid;
begin
  select * into a from public.program_applications where id = p_application for update;
  if not found or a.status <> 'accepted' then return; end if;
  update public.program_applications set status = 'enrolled', enrolled_at = now() where id = a.id;
  select team_id into v_team from public.program_divisions where id = a.division_id;
  if v_team is not null then
    insert into public.team_memberships (org_id, team_id, athlete_id, position, status)
    values (a.org_id, v_team, a.athlete_id, left(a.position, 60), 'active')
    on conflict (team_id, athlete_id) do update set status = 'active', left_on = null;
  end if;
  perform public.selection_ensure_registration(a.id);
end $$;

-- 0d) Backfill: every enrolled application gets its confirmed registration.
-- Idempotent; service role / migration only. Returns {confirmed, failed}.
create or replace function public.selection_backfill_registrations()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r record; v_ok int := 0; v_fail int := 0;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  for r in
    select a.id, a.org_id from public.program_applications a
     where a.status = 'enrolled'
       and not exists (select 1 from public.registrations g
                        where g.athlete_id = a.athlete_id and g.program_id = a.program_id
                          and g.camp_edition_id is null and g.status = 'confirmed')
     order by a.created_at
  loop
    if public.selection_ensure_registration(r.id) then
      v_ok := v_ok + 1;
      insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
      values (r.org_id, null, 'selection.registration_backfilled', 'program_applications', r.id,
              jsonb_build_object('fix', '20250420102900_selection_roster'));
    else
      v_fail := v_fail + 1;
    end if;
  end loop;
  return jsonb_build_object('confirmed', v_ok, 'failed', v_fail);
end $$;
revoke all on function public.selection_backfill_registrations() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.selection_backfill_registrations() to service_role;
  end if;
end $$;

do $$
declare v jsonb := public.selection_backfill_registrations();
begin
  raise notice 'selection roster backfill: % registration(s) confirmed, % failed (see audit_logs selection.registration_failed)',
    v->>'confirmed', v->>'failed';
end $$;

-- 1) Programme / package settings ----------------------------------------------
alter table public.programs add column if not exists series text;
alter table public.programs add column if not exists roster_coach_payment_status boolean not null default false;
comment on column public.programs.series is 'Groups the seasons of one programme (e.g. every season of the same selection team); null = slug without the year.';
comment on column public.programs.roster_coach_payment_status is 'Selection roster: assigned coaches see the payment status badge (never amounts).';

alter table public.program_packages add column if not exists tournament_count integer;
alter table public.program_packages add column if not exists monthly_amount numeric(12,2);
do $$ begin
  alter table public.program_packages add constraint program_packages_roster_chk check (
    (tournament_count is null or tournament_count between 1 and 50)
    and (monthly_amount is null or (monthly_amount > 0 and monthly_amount <= 1000000)));
exception when duplicate_object then null; end $$;
comment on column public.program_packages.tournament_count is 'Tournaments / stages the package covers (enrolment must pick this many unless overridden with a reason).';
comment on column public.program_packages.monthly_amount is 'Default monthly instalment amount for a monthly fee arrangement on this package.';

-- 2) Fee arrangement snapshot + withdrawal details --------------------------------
alter table public.program_applications add column if not exists agreed_fee numeric(12,2);
alter table public.program_applications add column if not exists agreed_currency text;
alter table public.program_applications add column if not exists arrangement_kind text;
alter table public.program_applications add column if not exists monthly_amount numeric(12,2);
alter table public.program_applications add column if not exists first_due_on date;
alter table public.program_applications add column if not exists arrangement_installments integer;
alter table public.program_applications add column if not exists tournaments_covered_count integer;
alter table public.program_applications add column if not exists tournament_override_reason text;
alter table public.program_applications add column if not exists agreed_at timestamptz;
alter table public.program_applications add column if not exists agreed_by uuid references public.profiles(id) on delete set null;
alter table public.program_applications add column if not exists withdrawal_reason text;
alter table public.program_applications add column if not exists withdrawn_by uuid references public.profiles(id) on delete set null;
alter table public.program_applications add column if not exists balance_at_withdrawal numeric(12,2);
do $$ begin
  alter table public.program_applications add constraint program_applications_arrangement_chk check (
    (arrangement_kind is null or arrangement_kind in ('full', 'monthly'))
    and (agreed_fee is null or agreed_fee >= 0)
    and (agreed_currency is null or agreed_currency ~ '^[A-Z]{3}$')
    and (monthly_amount is null or monthly_amount > 0)
    and (arrangement_installments is null or arrangement_installments between 1 and 24)
    and (tournaments_covered_count is null or tournaments_covered_count between 0 and 50)
    and (tournament_override_reason is null or char_length(tournament_override_reason) <= 500)
    and (withdrawal_reason is null or char_length(withdrawal_reason) <= 500));
exception when duplicate_object then null; end $$;
comment on column public.program_applications.agreed_fee is 'Fee arrangement snapshot: the fee agreed with the family (package price at agreement time).';

-- One live enrolment per player and programme. 20250420102600 created this
-- index; if it is missing (manual drop), report duplicates instead of failing.
do $$
declare r record; v_dups int := 0;
begin
  if to_regclass('public.uq_program_applications_live') is null then
    for r in
      select program_id, athlete_id, count(*) as n from public.program_applications
       where status not in ('declined', 'withdrawn') group by program_id, athlete_id having count(*) > 1
    loop
      v_dups := v_dups + 1;
      raise warning 'duplicate live selection application: program % athlete % (% rows)', r.program_id, r.athlete_id, r.n;
    end loop;
    if v_dups = 0 then
      create unique index uq_program_applications_live
        on public.program_applications(program_id, athlete_id) where status not in ('declined', 'withdrawn');
    else
      raise warning 'uq_program_applications_live NOT created: resolve the % duplicate(s) above, then rerun', v_dups;
    end if;
  end if;
end $$;

-- 3) Tournaments ---------------------------------------------------------------------
create table if not exists public.program_tournaments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  program_id  uuid not null references public.programs(id) on delete cascade,
  division_id uuid references public.program_divisions(id) on delete set null,
  name        text not null,
  stage       text,
  city        text,
  starts_on   date,
  ends_on     date,
  location    text,
  sort        integer not null default 0,
  status      text not null default 'planned',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint program_tournaments_chk check (
    char_length(btrim(name)) between 1 and 120
    and (location is null or char_length(location) <= 160)
    and (stage is null or char_length(stage) <= 80)
    and (city is null or char_length(city) <= 120)
    and (starts_on is null or ends_on is null or ends_on >= starts_on)
    and status in ('planned', 'confirmed', 'completed', 'cancelled'))
);
create index if not exists idx_program_tournaments_org on public.program_tournaments(org_id);
create index if not exists idx_program_tournaments_program on public.program_tournaments(program_id, sort, starts_on);
create unique index if not exists uq_program_tournaments_name on public.program_tournaments(program_id, lower(name));
comment on table public.program_tournaments is 'Tournaments / stages of a programme (selection programmes).';
comment on column public.program_tournaments.division_id is 'Age group the tournament is for (null = every division of the programme).';

create table if not exists public.application_tournaments (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  application_id  uuid not null references public.program_applications(id) on delete cascade,
  tournament_id   uuid not null references public.program_tournaments(id) on delete cascade,
  athlete_id      uuid references public.athletes(id) on delete cascade,
  status          text not null default 'covered',
  withdrawn_at    timestamptz,
  withdrawn_by    uuid references public.profiles(id) on delete set null,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint application_tournaments_chk check (
    status in ('covered', 'withdrawn')
    and (note is null or char_length(note) <= 500)
    and (status = 'covered' or withdrawn_at is not null))
);
create index if not exists idx_application_tournaments_org on public.application_tournaments(org_id);
create index if not exists idx_application_tournaments_tournament on public.application_tournaments(tournament_id);
create unique index if not exists uq_application_tournaments on public.application_tournaments(application_id, tournament_id);
-- A player is enrolled at most once per tournament (active coverage).
create unique index if not exists uq_application_tournaments_athlete
  on public.application_tournaments(tournament_id, athlete_id) where status = 'covered';
comment on table public.application_tournaments is 'Tournaments an enrolment covers (written only by the selection RPCs).';

do $$
declare t text;
begin
  foreach t in array array['program_tournaments', 'application_tournaments'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$s', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$s for each row execute function public.set_updated_at()', t);
  end loop;
end $$;
drop trigger if exists trg_audit_application_tournaments on public.application_tournaments;
create trigger trg_audit_application_tournaments after insert or update or delete on public.application_tournaments
  for each row execute function public.audit_trigger();

-- Same-org references.
create or replace function public.selection_tournament_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_prog uuid; v_ath uuid;
begin
  if tg_table_name = 'program_tournaments' then
    if not exists (select 1 from public.programs where id = new.program_id and org_id = new.org_id) then
      raise exception 'CROSS_TENANT_REFERENCE: program' using errcode = '42501';
    end if;
    if new.division_id is not null and not exists (
         select 1 from public.program_divisions where id = new.division_id and program_id = new.program_id and org_id = new.org_id) then
      raise exception 'CROSS_TENANT_REFERENCE: division' using errcode = '42501';
    end if;
  else
    select program_id, athlete_id into v_prog, v_ath from public.program_applications where id = new.application_id and org_id = new.org_id;
    if v_prog is null then raise exception 'CROSS_TENANT_REFERENCE: application' using errcode = '42501'; end if;
    new.athlete_id := v_ath;
    if not exists (select 1 from public.program_tournaments where id = new.tournament_id and org_id = new.org_id and program_id = v_prog) then
      raise exception 'CROSS_TENANT_REFERENCE: tournament' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['program_tournaments', 'application_tournaments'] loop
    execute format('drop trigger if exists trg_%1$s_same_org on public.%1$s', t);
    execute format('create trigger trg_%1$s_same_org before insert or update on public.%1$s for each row execute function public.selection_tournament_refs()', t);
  end loop;
end $$;

alter table public.program_tournaments enable row level security;
alter table public.application_tournaments enable row level security;

-- Tournaments: members of the club read (shown with the programme), admins write.
drop policy if exists program_tournaments_select on public.program_tournaments;
create policy program_tournaments_select on public.program_tournaments for select using (org_id = public.current_org_id());
drop policy if exists program_tournaments_insert on public.program_tournaments;
create policy program_tournaments_insert on public.program_tournaments for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists program_tournaments_update on public.program_tournaments;
create policy program_tournaments_update on public.program_tournaments for update
  using (org_id = public.current_org_id() and public.is_admin()) with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists program_tournaments_delete on public.program_tournaments;
create policy program_tournaments_delete on public.program_tournaments for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- Coverage: whoever may read the application (its own RLS: finance, the
-- family's guardians, the programme's assigned coaches). Writes: RPCs only.
drop policy if exists application_tournaments_select on public.application_tournaments;
create policy application_tournaments_select on public.application_tournaments for select
  using (org_id = public.current_org_id()
         and exists (select 1 from public.program_applications a where a.id = application_id));
drop policy if exists application_tournaments_insert on public.application_tournaments;
create policy application_tournaments_insert on public.application_tournaments for insert with check (false);
drop policy if exists application_tournaments_update on public.application_tournaments;
create policy application_tournaments_update on public.application_tournaments for update using (false) with check (false);
drop policy if exists application_tournaments_delete on public.application_tournaments;
create policy application_tournaments_delete on public.application_tournaments for delete using (false);

do $$
declare t text;
begin
  foreach t in array array['program_tournaments', 'application_tournaments'] loop
    execute format('drop policy if exists platform_tenant_isolation on public.%1$s', t);
    execute format('create policy platform_tenant_isolation on public.%1$s as restrictive for all using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()))', t);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on public.program_tournaments to authenticated;
    grant select on public.application_tournaments to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.program_tournaments, public.application_tournaments to service_role;
  end if;
end $$;

-- 4) Pure helpers (mirrored in src/lib/selection/arrangement.ts) ------------------------
-- Fee arrangement schedule: one amount on p_first (full), or monthly
-- instalments of p_monthly from p_first, the last one smaller when the total
-- is not a multiple.
create or replace function public.selection_arrangement_schedule(
  p_total numeric, p_kind text, p_monthly numeric, p_first date, p_currency text default 'CHF')
returns table (seq int, due_on date, amount numeric)
language plpgsql
stable
set search_path = public
as $$
declare
  v_exp   int := public.currency_exponent(p_currency);
  v_total numeric := round(coalesce(p_total, 0), v_exp);
  v_m     numeric;
  v_n     int;
  v_dates date[];
  k       int;
begin
  if p_first is null then raise exception 'INVALID_DATE' using errcode = 'P0001'; end if;
  if v_total <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  if p_kind = 'full' then
    seq := 1; due_on := p_first; amount := v_total; return next; return;
  end if;
  if p_kind is distinct from 'monthly' then raise exception 'INVALID_ARRANGEMENT' using errcode = 'P0001'; end if;
  v_m := round(coalesce(p_monthly, 0), v_exp);
  if v_m <= 0 then raise exception 'INVALID_MONTHLY_AMOUNT' using errcode = 'P0001'; end if;
  v_n := ceil(v_total / v_m)::int;
  if v_n > 24 then raise exception 'TOO_MANY_INSTALLMENTS' using errcode = 'P0001'; end if;
  v_dates := public.selection_due_dates(p_first, v_n);
  for k in 1 .. v_n loop
    seq := k; due_on := v_dates[k];
    amount := case when k < v_n then v_m else v_total - v_m * (v_n - 1) end;
    return next;
  end loop;
end $$;

-- Money of one invoice, derived from the ledger (no stored balance):
-- amount due (total + adjustment documents), received (net payments),
-- balance, next due date, overdue amount, status none / unpaid / partial / paid.
create or replace function public.selection_invoice_summary(p_invoice uuid)
returns table (amount_due numeric, received numeric, balance numeric, next_due_on date,
               overdue_amount numeric, payment_status text, currency text, has_plan boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v       public.invoices;
  v_today date := current_date;
  v_due   numeric;
  v_rcv   numeric;
  v_bal   numeric;
  v_plan  boolean;
  v_next  date;
  v_past  numeric;
begin
  select * into v from public.invoices where id = p_invoice;
  if not found or v.status::text in ('cancelled', 'void', 'draft') then
    amount_due := 0; received := 0; balance := 0; next_due_on := null; overdue_amount := 0;
    payment_status := 'none'; currency := v.currency; has_plan := false;
    return next; return;
  end if;
  v_due := public.invoice_amount_due(v.id);
  v_rcv := greatest(public.invoice_net_paid(v.id), 0);
  v_bal := greatest(v_due - v_rcv, 0);
  v_plan := exists (select 1 from public.payment_plans where invoice_id = v.id and kind = 'installments'
                     and status in ('active', 'paused', 'completed'));
  if v_plan then
    with inst as (
      select i.due_date, i.amount, sum(i.amount) over (order by i.seq) as cum
        from public.payment_plan_installments i join public.payment_plans p on p.id = i.plan_id
       where i.invoice_id = v.id and p.kind = 'installments' and p.status in ('active', 'paused', 'completed')
         and i.status not in ('cancelled', 'skipped'))
    select min(due_date) filter (where cum > v_rcv),
           coalesce(sum(amount) filter (where due_date < v_today), 0)
      into v_next, v_past
      from inst;
    if v_bal <= 0 then v_next := null; end if;
    v_past := least(v_bal, greatest(v_past - v_rcv, 0));
  else
    v_next := case when v_bal > 0 then v.due_date end;
    v_past := case when v_bal > 0 and v.due_date is not null and v.due_date < v_today then v_bal else 0 end;
  end if;
  amount_due := v_due; received := v_rcv; balance := v_bal; next_due_on := v_next;
  overdue_amount := coalesce(v_past, 0);
  payment_status := case when v_bal <= 0 then 'paid' when v_rcv > 0 then 'partial' else 'unpaid' end;
  currency := v.currency; has_plan := v_plan;
  return next;
end $$;

-- Caller may see the money of an application: finance of the club or a
-- guardian of the family (never coaches).
create or replace function public.selection_can_see_money(p_org uuid, p_family uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org = public.current_org_id() and (public.is_finance() or public.is_guardian_of_family(p_family));
$$;

-- Tournaments of an application as JSON (sorted).
create or replace function public.selection_application_tournaments_json(p_application uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'stage', t.stage, 'city', t.city,
                                               'location', t.location, 'starts_on', t.starts_on, 'ends_on', t.ends_on,
                                               'status', x.status, 'withdrawn_at', x.withdrawn_at, 'note', x.note)
                            order by t.sort, t.starts_on nulls last, lower(t.name)), '[]'::jsonb)
    from public.application_tournaments x join public.program_tournaments t on t.id = x.tournament_id
   where x.application_id = p_application;
$$;

-- 5a) Package invoice for an agreed amount (body of selection_issue_invoice
-- with the amount as a parameter).
create or replace function public.selection_issue_invoice(p_application uuid, p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  a      public.program_applications;
  pkg    public.program_packages;
  prog   public.programs;
  v_div  text;
  v_cur  text;
  v_num  text;
  v_inv  uuid;
  v_desc text;
begin
  select * into a from public.program_applications where id = p_application for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if a.package_id is null then raise exception 'PACKAGE_REQUIRED' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  select * into pkg from public.program_packages where id = a.package_id;
  select * into prog from public.programs where id = a.program_id;
  select name into v_div from public.program_divisions where id = a.division_id;
  v_cur := upper(coalesce(nullif(prog.currency, ''), (select currency from public.app_settings where org_id = a.org_id),
                          (select currency from public.organizations where id = a.org_id), 'CHF'));
  v_desc := left(prog.name || ' · ' || pkg.name || coalesce(' · ' || v_div, ''), 500);
  v_num := public.next_invoice_number(a.org_id);
  insert into public.invoices (org_id, number, family_id, athlete_id, program_id, description, status, due_date, currency, total_chf)
  values (a.org_id, v_num, a.family_id, a.athlete_id, a.program_id, v_desc, 'sent', current_date + 14, v_cur, p_amount)
  returning id into v_inv;
  insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
  values (a.org_id, v_inv, v_desc, 1, p_amount, p_amount);
  update public.program_applications set invoice_id = v_inv where id = a.id;
  return v_inv;
end $$;

-- Division fit for a date of birth (same rule as selection_suggest_division):
-- true / false; null = the division has no age rule or no date of birth.
-- Staff adding / moving a player confirm anything but true.
create or replace function public.selection_division_fits(p_division uuid, p_dob date, p_today date default current_date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_dob is null or d.id is null then null
    when d.min_birth_year is null and d.max_birth_year is null and d.age_under is null then null
    else (d.min_birth_year is null or extract(year from p_dob)::int >= d.min_birth_year)
     and (d.max_birth_year is null or extract(year from p_dob)::int <= d.max_birth_year)
     and (d.age_under is null or extract(year from age(coalesce(d.age_cutoff, p_today), p_dob))::int < d.age_under)
  end
  from (select 1) one left join public.program_divisions d on d.id = p_division;
$$;

-- 5) Fee arrangement ------------------------------------------------------------------------
-- Internal: apply a fee arrangement to an accepted / enrolled application.
-- Caller has checked role and org. Before any payment the unpaid invoice is
-- cancelled (kept, with the reason) and a new one issued; once money was
-- received the invoice is kept and a credit / debit note (reason required)
-- covers a fee difference, and the instalment plan is rebuilt on the amount
-- due (payments already received settle the first instalments).
create or replace function public.selection_apply_arrangement_internal(
  p_application uuid, p_kind text, p_package uuid, p_monthly numeric, p_first date, p_reason text, p_fee numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a       public.program_applications;
  pkg     public.program_packages;
  prog    public.programs;
  v       public.invoices;
  v_cur   text;
  v_fee   numeric;
  v_first date := coalesce(p_first, current_date);
  v_inv   uuid;
  v_paid  boolean;
  v_diff  numeric;
  v_dates date[];
  v_amts  numeric[];
  v_n     int;
  v_plan  uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_old   jsonb;
begin
  select * into a from public.program_applications where id = p_application for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if a.status not in ('accepted', 'enrolled') then raise exception 'NOT_ACCEPTED' using errcode = 'P0001'; end if;
  select * into pkg from public.program_packages where id = coalesce(p_package, a.package_id) and program_id = a.program_id;
  if not found then raise exception 'PACKAGE_REQUIRED' using errcode = 'P0001'; end if;
  if p_kind not in ('full', 'monthly') then raise exception 'INVALID_ARRANGEMENT' using errcode = 'P0001'; end if;
  select * into prog from public.programs where id = a.program_id;
  v_cur := upper(coalesce(nullif(prog.currency, ''), (select currency from public.app_settings where org_id = a.org_id),
                          (select currency from public.organizations where id = a.org_id), 'CHF'));
  v_fee := round(coalesce(p_fee, pkg.price), public.currency_exponent(v_cur));
  if v_fee <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  -- A fee other than the package price needs a reason (admin / finance only: callers check).
  if v_fee <> round(pkg.price, public.currency_exponent(v_cur)) and v_reason is null then
    raise exception 'FEE_REASON_REQUIRED' using errcode = 'P0001';
  end if;
  -- Validates the schedule (monthly amount, count <= 24) before anything changes.
  select array_agg(s.due_on order by s.seq), array_agg(s.amount order by s.seq)
    into v_dates, v_amts
    from public.selection_arrangement_schedule(v_fee, p_kind, p_monthly, v_first, v_cur) s;
  v_n := cardinality(v_dates);
  v_old := jsonb_build_object('package_id', a.package_id, 'agreed_fee', a.agreed_fee, 'arrangement_kind', a.arrangement_kind,
                              'monthly_amount', a.monthly_amount, 'first_due_on', a.first_due_on, 'invoice_id', a.invoice_id);

  v_inv := a.invoice_id;
  if v_inv is not null and (select status::text from public.invoices where id = v_inv) in ('cancelled', 'void') then
    v_inv := null;
  end if;
  v_paid := v_inv is not null and exists (select 1 from public.payments where invoice_id = v_inv and status::text = 'succeeded'
                                                                       and voided_at is null and amount_chf > 0);

  if v_inv is not null and not v_paid then
    -- Clean re-issue (history: the old invoice stays, cancelled with the reason).
    if not public.selection_cancel_invoice(v_inv, coalesce(v_reason, 'Fee arrangement changed')) then
      raise exception 'ARRANGEMENT_LOCKED' using errcode = 'P0001';
    end if;
    v_inv := null;
  end if;

  update public.program_applications set package_id = pkg.id where id = a.id;

  if v_inv is null then
    v_inv := public.selection_issue_invoice(a.id, v_fee);
    update public.invoices set due_date = v_first where id = v_inv;
  else
    -- Money received: the paid invoice is never edited.
    if v_reason is null then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
    v_diff := v_fee - coalesce(a.agreed_fee, (select total_chf from public.invoices where id = v_inv));
    if v_diff > 0 then
      perform public.issue_invoice_adjustment(v_inv, 'debit_note', v_diff, v_reason, null);
    elsif v_diff < 0 then
      perform public.issue_invoice_adjustment(v_inv, 'credit_note', -v_diff, v_reason, null);
    end if;
    update public.payment_plan_installments set status = 'cancelled'
     where invoice_id = v_inv and status = 'scheduled'
       and plan_id in (select id from public.payment_plans where invoice_id = v_inv and kind = 'installments' and status in ('active', 'paused'));
    update public.payment_plans set status = 'cancelled', cancel_reason = left(v_reason, 500)
     where invoice_id = v_inv and kind = 'installments' and status in ('active', 'paused', 'completed');
    update public.invoices set due_date = v_first where id = v_inv;
  end if;

  if v_n >= 2 then
    select * into v from public.invoices where id = v_inv for update;
    -- The plan covers the whole amount due; received money settles the first instalments.
    select array_agg(s.due_on order by s.seq), array_agg(s.amount order by s.seq)
      into v_dates, v_amts
      from public.selection_arrangement_schedule(public.invoice_amount_due(v_inv), p_kind, p_monthly, v_first, v.currency) s;
    v_n := cardinality(v_dates);
    if v_n >= 2 then
      v_plan := public.plan_create_internal(v, v_dates, v_amts, 0, 'invoice', 'monthly');
    else
      update public.invoices set due_date = v_dates[1] where id = v_inv;
    end if;
  end if;
  perform public.refresh_invoice_overdue(v_inv);

  update public.program_applications
     set package_id = pkg.id, agreed_fee = v_fee, agreed_currency = v_cur, arrangement_kind = p_kind,
         monthly_amount = case when p_kind = 'monthly' then round(p_monthly, public.currency_exponent(v_cur)) end,
         first_due_on = v_first, arrangement_installments = v_n, installment_count = v_n,
         tournaments_covered_count = pkg.tournament_count, agreed_at = now(), agreed_by = auth.uid()
   where id = a.id;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (a.org_id, auth.uid(), 'selection.arrangement_set', 'program_applications', a.id, v_old,
          jsonb_build_object('package_id', pkg.id, 'agreed_fee', v_fee, 'currency', v_cur, 'arrangement_kind', p_kind,
                             'monthly_amount', p_monthly, 'first_due_on', v_first, 'installments', v_n,
                             'invoice_id', v_inv, 'plan_id', v_plan, 'reason', v_reason, 'had_payments', v_paid));
  return jsonb_build_object('application_id', a.id, 'invoice_id', v_inv, 'plan_id', v_plan, 'installments', v_n,
                            'agreed_fee', v_fee, 'currency', v_cur, 'reissued', not v_paid);
end $$;

-- Finance / admin: set or change the fee arrangement.
create or replace function public.selection_set_arrangement(
  p_application uuid, p_kind text, p_package uuid default null, p_monthly numeric default null,
  p_first date default null, p_reason text default null, p_fee numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public.program_applications;
begin
  select * into a from public.program_applications where id = p_application;
  if not found or a.org_id is distinct from public.current_org_id() or not public.is_finance_of(a.org_id) then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  return public.selection_apply_arrangement_internal(a.id, p_kind, p_package, p_monthly, p_first, p_reason, p_fee);
end $$;

-- 6) Tournaments of an enrolment ----------------------------------------------------------------
create or replace function public.selection_set_tournaments_internal(
  p_application uuid, p_tournaments uuid[], p_override_reason text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  a        public.program_applications;
  v_ids    uuid[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_tournaments, '{}'::uuid[])) x where x is not null), '{}'::uuid[]);
  v_need   int;
  v_n      int := cardinality(coalesce((select array_agg(distinct x) from unnest(coalesce(p_tournaments, '{}'::uuid[])) x where x is not null), '{}'::uuid[]));
  v_reason text := nullif(btrim(coalesce(p_override_reason, '')), '');
begin
  select * into a from public.program_applications where id = p_application for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if a.status = 'withdrawn' then raise exception 'ENROLLMENT_WITHDRAWN' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(v_ids) x
              where not exists (select 1 from public.program_tournaments t
                                 where t.id = x and t.program_id = a.program_id and t.org_id = a.org_id)) then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_ids) x join public.program_tournaments t on t.id = x
              where t.division_id is not null and t.division_id is distinct from a.division_id) then
    raise exception 'TOURNAMENT_DIVISION_MISMATCH' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.application_tournaments x
              where x.tournament_id = any(v_ids) and x.athlete_id = a.athlete_id and x.status = 'covered'
                and x.application_id <> a.id) then
    raise exception 'DUPLICATE_TOURNAMENT' using errcode = 'P0001';
  end if;
  v_need := coalesce(a.tournaments_covered_count, (select tournament_count from public.program_packages where id = a.package_id));
  if v_need is not null and v_n <> v_need and v_reason is null then
    raise exception 'TOURNAMENT_COUNT_MISMATCH' using errcode = 'P0001';
  end if;
  delete from public.application_tournaments
   where application_id = a.id and status = 'covered' and not (tournament_id = any(v_ids));
  insert into public.application_tournaments (org_id, application_id, tournament_id, status)
  select a.org_id, a.id, x, 'covered' from unnest(v_ids) x
  on conflict (application_id, tournament_id) do update
    set status = 'covered', withdrawn_at = null, withdrawn_by = null, note = null
    where public.application_tournaments.status <> 'covered';
  update public.program_applications
     set tournament_override_reason = case when v_need is not null and v_n <> v_need then left(v_reason, 500) end
   where id = a.id;
  return v_n;
end $$;

create or replace function public.selection_set_tournaments(
  p_application uuid, p_tournaments uuid[], p_override_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public.program_applications; v_n int;
begin
  select * into a from public.program_applications where id = p_application;
  if not found or a.org_id is distinct from public.current_org_id() or not public.selection_is_admin_of(a.org_id) then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_n := public.selection_set_tournaments_internal(a.id, p_tournaments, p_override_reason);
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (a.org_id, auth.uid(), 'selection.tournaments_set', 'program_applications', a.id,
          jsonb_build_object('tournaments', to_jsonb(p_tournaments), 'override_reason', nullif(btrim(coalesce(p_override_reason, '')), '')));
  return jsonb_build_object('application_id', a.id, 'covered', v_n);
end $$;

create or replace function public.selection_withdraw_tournament(p_application uuid, p_tournament uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public.program_applications; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into a from public.program_applications where id = p_application;
  if not found or a.org_id is distinct from public.current_org_id() or not public.selection_is_admin_of(a.org_id) then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_reason is null then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  update public.application_tournaments
     set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = auth.uid(), note = left(v_reason, 500)
   where application_id = a.id and tournament_id = p_tournament and status = 'covered';
  if not found then raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0001'; end if;
  return jsonb_build_object('application_id', a.id, 'tournament_id', p_tournament, 'status', 'withdrawn');
end $$;

-- 7) Staff: add a player from the directory -----------------------------------------------------
create or replace function public.selection_staff_add(
  p_program uuid, p_athlete uuid, p_division uuid, p_package uuid, p_tournaments uuid[] default '{}',
  p_kind text default 'full', p_monthly numeric default null, p_first date default null,
  p_status text default 'enrolled', p_override_reason text default null, p_notes text default null,
  p_fee numeric default null, p_fee_reason text default null, p_age_confirmed boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid := public.current_org_id();
  prog   public.programs;
  ath    public.athletes;
  v_fam  public.families;
  v_live public.program_applications;
  v_id   uuid;
  v_arr  jsonb;
begin
  if v_org is null or not public.selection_is_admin_of(v_org) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into prog from public.programs where id = p_program and org_id = v_org;
  if not found or not (prog.selection_enabled or prog.kind::text = 'selection') then
    raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_status not in ('accepted', 'enrolled') then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
  select * into ath from public.athletes where id = p_athlete and org_id = v_org;
  if not found or ath.status = 'archived' then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_live from public.program_applications
   where program_id = p_program and athlete_id = p_athlete and status not in ('declined', 'withdrawn') limit 1;
  if found then
    raise exception 'ALREADY_ENROLLED' using errcode = 'P0001',
      detail = v_live.id::text;
  end if;
  if p_division is not null and not exists (select 1 from public.program_divisions where id = p_division and program_id = p_program) then
    raise exception 'DIVISION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_division is null and exists (select 1 from public.program_divisions where program_id = p_program and is_active) then
    raise exception 'DIVISION_REQUIRED' using errcode = 'P0001';
  end if;
  if p_package is null or not exists (select 1 from public.program_packages where id = p_package and program_id = p_program) then
    raise exception 'PACKAGE_REQUIRED' using errcode = 'P0001';
  end if;
  if p_division is not null and public.selection_division_fits(p_division, ath.dob) is distinct from true and not coalesce(p_age_confirmed, false) then
    raise exception 'AGE_GROUP_MISMATCH' using errcode = 'P0001';
  end if;
  select * into v_fam from public.families where id = ath.family_id;

  insert into public.program_applications
    (org_id, program_id, division_id, package_id, athlete_id, family_id, status, is_member, source,
     staff_notes, applied_by, reviewed_by, reviewed_at, accepted_at)
  values (v_org, p_program, p_division, p_package, p_athlete, ath.family_id, 'accepted',
          coalesce(v_fam.membership_status, 'member') = 'member', 'admin',
          left(nullif(btrim(coalesce(p_notes, '')), ''), 2000), auth.uid(), auth.uid(), now(), now())
  returning id into v_id;

  v_arr := public.selection_apply_arrangement_internal(v_id, p_kind, p_package, p_monthly, p_first, p_fee_reason, p_fee);
  perform public.selection_set_tournaments_internal(v_id, coalesce(p_tournaments, '{}'::uuid[]), p_override_reason);
  if p_status = 'enrolled' then perform public.selection_enroll_internal(v_id); end if;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'selection.staff_added', 'program_applications', v_id,
          jsonb_build_object('program_id', p_program, 'athlete_id', p_athlete, 'status', p_status, 'arrangement', v_arr));
  return (select jsonb_build_object('application_id', a.id, 'status', a.status, 'invoice_id', a.invoice_id, 'family_id', a.family_id)
            from public.program_applications a where a.id = v_id);
end $$;

-- 8) Withdraw an enrolment (keeps invoice, payments and plan) ----------------------------------------
create or replace function public.selection_withdraw_enrollment(p_application uuid, p_reason text, p_on date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a        public.program_applications;
  v_team   uuid;
  v_bal    numeric := 0;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_on     date := coalesce(p_on, current_date);
begin
  select * into a from public.program_applications where id = p_application for update;
  if not found or a.org_id is distinct from public.current_org_id() or not public.selection_is_admin_of(a.org_id) then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_reason is null then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if v_on > current_date then raise exception 'INVALID_DATE' using errcode = 'P0001'; end if;
  if not public.selection_transition_ok(a.status, 'withdrawn') then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
  if a.invoice_id is not null then
    select s.balance into v_bal from public.selection_invoice_summary(a.invoice_id) s;
  end if;
  update public.program_applications
     set status = 'withdrawn', withdrawn_at = v_on::timestamptz + interval '12 hours', withdrawn_by = auth.uid(),
         withdrawal_reason = left(v_reason, 500), balance_at_withdrawal = coalesce(v_bal, 0)
   where id = a.id;
  update public.application_tournaments
     set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = auth.uid(), note = coalesce(note, left(v_reason, 500))
   where application_id = a.id and status = 'covered';
  select team_id into v_team from public.program_divisions where id = a.division_id;
  if v_team is not null then
    update public.team_memberships set status = 'inactive', left_on = greatest(joined_on, v_on)
     where team_id = v_team and athlete_id = a.athlete_id and status <> 'inactive';
  end if;
  update public.registrations set status = 'cancelled'
   where program_id = a.program_id and athlete_id = a.athlete_id and camp_edition_id is null and status in ('pending', 'confirmed');
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (a.org_id, auth.uid(), 'selection.enrollment_withdrawn', 'program_applications', a.id,
          jsonb_build_object('status', a.status),
          jsonb_build_object('reason', v_reason, 'withdrawn_on', v_on, 'balance_at_withdrawal', coalesce(v_bal, 0),
                             'invoice_id', a.invoice_id));
  return jsonb_build_object('application_id', a.id, 'status', 'withdrawn', 'previous_status', a.status,
                            'balance_at_withdrawal', coalesce(v_bal, 0), 'invoice_id', a.invoice_id, 'family_id', a.family_id);
end $$;

-- 9) Edit an enrolment ----------------------------------------------------------------------------------
-- payload: division_id, jersey_number (null / '' clears), staff_notes, status
-- (accepted / enrolled / waitlisted through the normal transitions).
create or replace function public.selection_update_enrollment(p_application uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a        public.program_applications;
  v_div    uuid;
  v_old_t  uuid;
  v_new_t  uuid;
  v_jersey int;
  v_status text := nullif(p_payload->>'status', '');
begin
  select * into a from public.program_applications where id = p_application for update;
  if not found or a.org_id is distinct from public.current_org_id() or not public.selection_is_admin_of(a.org_id) then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if a.status = 'withdrawn' and (p_payload ? 'division_id' or p_payload ? 'jersey_number') then
    raise exception 'ENROLLMENT_WITHDRAWN' using errcode = 'P0001';
  end if;

  -- Division (team roster follows).
  if p_payload ? 'division_id' then
    v_div := nullif(p_payload->>'division_id', '')::uuid;
    if v_div is distinct from a.division_id then
      if v_div is null or not exists (select 1 from public.program_divisions where id = v_div and program_id = a.program_id and org_id = a.org_id) then
        raise exception 'DIVISION_NOT_FOUND' using errcode = 'P0001';
      end if;
      if public.selection_division_fits(v_div, (select dob from public.athletes where id = a.athlete_id)) is distinct from true
         and not coalesce((p_payload->>'age_confirmed')::boolean, false) then
        raise exception 'AGE_GROUP_MISMATCH' using errcode = 'P0001';
      end if;
      -- Tournaments of another age group no longer apply.
      if exists (select 1 from public.application_tournaments x join public.program_tournaments t on t.id = x.tournament_id
                  where x.application_id = a.id and x.status = 'covered' and t.division_id is not null and t.division_id <> v_div) then
        raise exception 'TOURNAMENT_DIVISION_MISMATCH' using errcode = 'P0001';
      end if;
      select team_id into v_old_t from public.program_divisions where id = a.division_id;
      select team_id into v_new_t from public.program_divisions where id = v_div;
      update public.program_applications set division_id = v_div where id = a.id;
      if a.status = 'enrolled' and v_old_t is distinct from v_new_t then
        if v_old_t is not null then
          update public.team_memberships set status = 'inactive', left_on = greatest(joined_on, current_date)
           where team_id = v_old_t and athlete_id = a.athlete_id and status <> 'inactive';
        end if;
        if v_new_t is not null then
          insert into public.team_memberships (org_id, team_id, athlete_id, position, status)
          values (a.org_id, v_new_t, a.athlete_id, left(a.position, 60), 'active')
          on conflict (team_id, athlete_id) do update set status = 'active', left_on = null;
        end if;
      end if;
      a.division_id := v_div;
    end if;
  end if;

  -- Jersey number on the division team.
  if p_payload ? 'jersey_number' then
    v_jersey := nullif(btrim(coalesce(p_payload->>'jersey_number', '')), '')::int;
    if v_jersey is not null and (v_jersey < 0 or v_jersey > 999) then raise exception 'INVALID_JERSEY' using errcode = 'P0001'; end if;
    select team_id into v_new_t from public.program_divisions where id = a.division_id;
    if v_new_t is null then
      if v_jersey is not null then raise exception 'NO_TEAM_FOR_JERSEY' using errcode = 'P0001'; end if;
    else
      if v_jersey is not null and exists (
           select 1 from public.team_memberships where team_id = v_new_t and jersey_number = v_jersey
              and athlete_id <> a.athlete_id and status <> 'inactive') then
        raise exception 'JERSEY_TAKEN' using errcode = 'P0001';
      end if;
      update public.team_memberships set jersey_number = v_jersey
       where team_id = v_new_t and athlete_id = a.athlete_id and jersey_number is distinct from v_jersey;
      if not found and v_jersey is not null
         and not exists (select 1 from public.team_memberships where team_id = v_new_t and athlete_id = a.athlete_id) then
        raise exception 'NOT_ON_TEAM' using errcode = 'P0001';
      end if;
    end if;
  end if;

  if p_payload ? 'staff_notes' then
    update public.program_applications set staff_notes = left(nullif(btrim(coalesce(p_payload->>'staff_notes', '')), ''), 2000)
     where id = a.id;
  end if;

  if v_status is not null and v_status <> a.status then
    if v_status not in ('accepted', 'enrolled', 'waitlisted') then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
    perform public.selection_set_status(a.id, v_status, null, null, null);
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (a.org_id, auth.uid(), 'selection.enrollment_updated', 'program_applications', a.id, p_payload);
  return (select jsonb_build_object('application_id', id, 'status', status, 'division_id', division_id, 'previous_status', a.status,
                                    'family_id', family_id)
            from public.program_applications where id = a.id);
end $$;

-- 10) Move to another season / programme (only before any payment) ---------------------------------------
create or replace function public.selection_move_enrollment(p_application uuid, p_program uuid, p_division uuid, p_package uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a        public.program_applications;
  prog     public.programs;
  v_team   uuid;
  v_was    text;
begin
  select * into a from public.program_applications where id = p_application for update;
  if not found or a.org_id is distinct from public.current_org_id() or not public.selection_is_admin_of(a.org_id) then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if a.status not in ('accepted', 'enrolled', 'waitlisted') then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
  if p_program = a.program_id then raise exception 'SAME_PROGRAM' using errcode = 'P0001'; end if;
  select * into prog from public.programs where id = p_program and org_id = a.org_id;
  if not found or not (prog.selection_enabled or prog.kind::text = 'selection') then raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002'; end if;
  if a.invoice_id is not null and exists (select 1 from public.payments where invoice_id = a.invoice_id and status::text = 'succeeded'
                                                                          and voided_at is null and amount_chf > 0) then
    raise exception 'MOVE_HAS_PAYMENTS' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.program_applications where program_id = p_program and athlete_id = a.athlete_id
                and status not in ('declined', 'withdrawn')) then
    raise exception 'ALREADY_ENROLLED' using errcode = 'P0001';
  end if;
  if p_division is not null and not exists (select 1 from public.program_divisions where id = p_division and program_id = p_program) then
    raise exception 'DIVISION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_division is null and exists (select 1 from public.program_divisions where program_id = p_program and is_active) then
    raise exception 'DIVISION_REQUIRED' using errcode = 'P0001';
  end if;
  if p_package is null or not exists (select 1 from public.program_packages where id = p_package and program_id = p_program) then
    raise exception 'PACKAGE_REQUIRED' using errcode = 'P0001';
  end if;

  if a.invoice_id is not null and not public.selection_cancel_invoice(a.invoice_id, 'Moved to another season') then
    raise exception 'MOVE_HAS_PAYMENTS' using errcode = 'P0001';
  end if;
  select team_id into v_team from public.program_divisions where id = a.division_id;
  if v_team is not null then
    update public.team_memberships set status = 'inactive', left_on = greatest(joined_on, current_date)
     where team_id = v_team and athlete_id = a.athlete_id and status <> 'inactive';
  end if;
  update public.registrations set status = 'cancelled'
   where program_id = a.program_id and athlete_id = a.athlete_id and camp_edition_id is null and status in ('pending', 'confirmed');
  delete from public.application_tournaments where application_id = a.id;

  v_was := a.status;
  update public.program_applications
     set program_id = p_program, division_id = p_division, package_id = p_package, invoice_id = null, installment_count = null,
         tournaments_covered_count = null, tournament_override_reason = null,
         status = case when v_was = 'waitlisted' then 'waitlisted' else 'accepted' end
   where id = a.id;
  if v_was <> 'waitlisted' then
    if a.arrangement_kind is not null then
      perform public.selection_apply_arrangement_internal(a.id, a.arrangement_kind, p_package, a.monthly_amount,
                                                          greatest(coalesce(a.first_due_on, current_date), current_date), 'Moved to another season', null);
    else
      perform public.selection_issue_invoice(a.id);
    end if;
    if v_was = 'enrolled' then perform public.selection_enroll_internal(a.id); end if;
  end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (a.org_id, auth.uid(), 'selection.enrollment_moved', 'program_applications', a.id,
          jsonb_build_object('program_id', a.program_id, 'division_id', a.division_id, 'package_id', a.package_id, 'invoice_id', a.invoice_id),
          jsonb_build_object('program_id', p_program, 'division_id', p_division, 'package_id', p_package));
  return (select jsonb_build_object('application_id', id, 'program_id', program_id, 'status', status, 'invoice_id', invoice_id)
            from public.program_applications where id = a.id);
end $$;

-- 10b) Save an enrolment from the single staff form (admin), atomically:
-- season / programme (move, only without payments), division, tournaments,
-- fee arrangement, jersey, notes, status. payload:
--   program_id, division_id, package_id, tournaments (uuid[]),
--   tournament_override_reason, age_confirmed, jersey_number, staff_notes,
--   status, arrangement {kind, fee, monthly, first_due_on, reason},
--   fee_confirmed (required when the agreed fee changes).
create or replace function public.selection_save_enrollment(p_application uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a        public.program_applications;
  v_prog   uuid := nullif(p_payload->>'program_id', '')::uuid;
  v_div    uuid := nullif(p_payload->>'division_id', '')::uuid;
  v_pkg    uuid := nullif(p_payload->>'package_id', '')::uuid;
  v_arr    jsonb := p_payload->'arrangement';
  v_tids   uuid[];
  v_kind   text;
  v_fee    numeric;
  v_mon    numeric;
  v_first  date;
  v_upd    jsonb := '{}'::jsonb;
  v_status text := nullif(p_payload->>'status', '');
  v_cur_fee numeric;
begin
  select * into a from public.program_applications where id = p_application;
  if not found or a.org_id is distinct from public.current_org_id() or not public.selection_is_admin_of(a.org_id) then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if a.status = 'withdrawn' then raise exception 'ENROLLMENT_WITHDRAWN' using errcode = 'P0001'; end if;

  -- Season / programme.
  if v_prog is not null and v_prog <> a.program_id then
    perform public.selection_move_enrollment(a.id, v_prog, v_div, coalesce(v_pkg, a.package_id));
    select * into a from public.program_applications where id = p_application;
  end if;

  -- Tournaments no longer selected leave first (a division change may need it).
  if p_payload ? 'tournaments' then
    select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_tids
      from jsonb_array_elements_text(coalesce(p_payload->'tournaments', '[]'::jsonb)) x;
    delete from public.application_tournaments where application_id = a.id and status = 'covered' and not (tournament_id = any(v_tids));
  end if;

  -- Division, jersey, notes (status last).
  if v_div is not null and v_div is distinct from a.division_id then
    v_upd := v_upd || jsonb_build_object('division_id', v_div, 'age_confirmed', coalesce((p_payload->>'age_confirmed')::boolean, false));
  end if;
  if p_payload ? 'jersey_number' then v_upd := v_upd || jsonb_build_object('jersey_number', p_payload->'jersey_number'); end if;
  if p_payload ? 'staff_notes' then v_upd := v_upd || jsonb_build_object('staff_notes', p_payload->'staff_notes'); end if;
  if v_upd <> '{}'::jsonb then perform public.selection_update_enrollment(a.id, v_upd); end if;
  select * into a from public.program_applications where id = p_application;

  -- Fee arrangement, when it changes.
  if v_arr is not null and jsonb_typeof(v_arr) = 'object' and a.status in ('accepted', 'enrolled') then
    v_kind := coalesce(nullif(v_arr->>'kind', ''), a.arrangement_kind, 'full');
    v_fee := nullif(v_arr->>'fee', '')::numeric;
    v_mon := nullif(v_arr->>'monthly', '')::numeric;
    v_first := coalesce(nullif(v_arr->>'first_due_on', '')::date, a.first_due_on, current_date);
    v_cur_fee := coalesce(a.agreed_fee, (select total_chf from public.invoices where id = a.invoice_id));
    if v_kind is distinct from a.arrangement_kind or coalesce(v_pkg, a.package_id) is distinct from a.package_id
       or (v_fee is not null and v_fee is distinct from v_cur_fee)
       or (v_kind = 'monthly' and v_mon is distinct from a.monthly_amount)
       or v_first is distinct from a.first_due_on then
      if v_fee is distinct from v_cur_fee and v_cur_fee is not null and not coalesce((p_payload->>'fee_confirmed')::boolean, false)
         and coalesce(v_fee, (select price from public.program_packages where id = coalesce(v_pkg, a.package_id))) is distinct from v_cur_fee then
        raise exception 'FEE_CONFIRMATION_REQUIRED' using errcode = 'P0001';
      end if;
      perform public.selection_apply_arrangement_internal(a.id, v_kind, coalesce(v_pkg, a.package_id), v_mon, v_first,
                                                          nullif(btrim(coalesce(v_arr->>'reason', '')), ''), v_fee);
    end if;
  end if;

  if p_payload ? 'tournaments' then
    perform public.selection_set_tournaments_internal(a.id, v_tids, p_payload->>'tournament_override_reason');
  end if;

  if v_status is not null and v_status <> a.status then
    if v_status = 'withdrawn' then raise exception 'USE_WITHDRAW' using errcode = 'P0001'; end if;
    perform public.selection_update_enrollment(a.id, jsonb_build_object('status', v_status));
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (a.org_id, auth.uid(), 'selection.enrollment_saved', 'program_applications', a.id, p_payload);
  return (select jsonb_build_object('application_id', x.id, 'program_id', x.program_id, 'status', x.status, 'invoice_id', x.invoice_id,
                                    'family_id', x.family_id)
            from public.program_applications x where x.id = a.id);
end $$;

-- 11) Reading -----------------------------------------------------------------------------------------------
-- Roster of a programme: accepted / waitlisted / enrolled players and the
-- withdrawn history. Finance (admin / finance) sees money; the programme's
-- assigned coaches see their divisions without amounts (payment status only
-- when the programme allows it); nobody else gets rows.
create or replace function public.selection_roster(p_program uuid)
returns table (
  application_id uuid, athlete_id uuid, first_name text, last_name text, birth_year int,
  division_id uuid, division_name text, package_id uuid, package_name text, status text, source text,
  tournaments jsonb, tournaments_required int, tournament_override_reason text,
  arrangement_kind text, agreed_fee numeric, monthly_amount numeric, first_due_on date, installment_count int,
  currency text, amount_due numeric, received numeric, balance numeric, next_due_on date, overdue boolean,
  overdue_amount numeric, payment_status text, show_money boolean, invoice_id uuid, jersey_number int,
  staff_notes text, accepted_at timestamptz, enrolled_at timestamptz, withdrawn_at timestamptz,
  withdrawal_reason text, balance_at_withdrawal numeric, registration_ok boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_fin   boolean := public.is_finance();
  v_badge boolean;
begin
  select p.roster_coach_payment_status into v_badge from public.programs p where p.id = p_program and p.org_id = v_org;
  if not found then return; end if;
  return query
    select a.id, a.athlete_id, t.first_name, t.last_name, extract(year from t.dob)::int,
           a.division_id, d.name, a.package_id, k.name, a.status, a.source,
           public.selection_application_tournaments_json(a.id),
           coalesce(a.tournaments_covered_count, k.tournament_count), a.tournament_override_reason,
           a.arrangement_kind,
           case when v_fin then a.agreed_fee::numeric end,
           case when v_fin then a.monthly_amount::numeric end,
           case when v_fin then a.first_due_on end,
           case when v_fin then coalesce(a.arrangement_installments, a.installment_count) end,
           case when v_fin then coalesce(s.currency, a.agreed_currency) end,
           case when v_fin then s.amount_due end,
           case when v_fin then s.received end,
           case when v_fin then s.balance end,
           case when v_fin then s.next_due_on end,
           case when v_fin or v_badge then coalesce(s.overdue_amount, 0) > 0 end,
           case when v_fin then s.overdue_amount end,
           case when v_fin or v_badge then coalesce(s.payment_status, 'none') end,
           v_fin,
           case when v_fin then a.invoice_id end,
           (select tm.jersey_number::int from public.team_memberships tm where tm.team_id = d.team_id and tm.athlete_id = a.athlete_id),
           a.staff_notes, a.accepted_at, a.enrolled_at, a.withdrawn_at, a.withdrawal_reason,
           case when v_fin then a.balance_at_withdrawal::numeric end,
           case when a.status <> 'enrolled' then null
                else exists (select 1 from public.registrations g where g.athlete_id = a.athlete_id and g.program_id = a.program_id
                              and g.camp_edition_id is null and g.status = 'confirmed') end
      from public.program_applications a
      join public.athletes t on t.id = a.athlete_id
      left join public.program_divisions d on d.id = a.division_id
      left join public.program_packages k on k.id = a.package_id
      left join lateral (select * from public.selection_invoice_summary(a.invoice_id)) s on a.invoice_id is not null
     where a.program_id = p_program and a.org_id = v_org
       and (a.status in ('accepted', 'waitlisted', 'enrolled')
            or (a.status = 'withdrawn' and (a.accepted_at is not null or a.enrolled_at is not null)))
       and (v_fin or public.selection_coach_reviews(a.program_id, a.division_id))
     order by d.sort nulls last, t.last_name, t.first_name;
end $$;

-- Enrolments of one athlete (profile card). Rows: finance, the athlete's
-- guardians, the programme's assigned coaches or coaches who already coach
-- the athlete. Money only for finance and guardians.
create or replace function public.selection_athlete_enrollments(p_athlete uuid)
returns table (
  application_id uuid, program_id uuid, program_name text, season_year int, division_name text, package_name text,
  status text, tournaments jsonb, arrangement_kind text, agreed_fee numeric, monthly_amount numeric,
  currency text, amount_due numeric, received numeric, balance numeric, next_due_on date, overdue boolean,
  payment_status text, show_money boolean, accepted_at timestamptz, enrolled_at timestamptz,
  withdrawn_at timestamptz, withdrawal_reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id(); v_fam uuid;
begin
  select family_id into v_fam from public.athletes where id = p_athlete and org_id = v_org;
  if not found then return; end if;
  return query
    with apps as (
      select a.*, public.selection_can_see_money(a.org_id, a.family_id) as money
        from public.program_applications a
       where a.athlete_id = p_athlete and a.org_id = v_org
         and (a.status in ('accepted', 'waitlisted', 'enrolled')
              or (a.status = 'withdrawn' and (a.accepted_at is not null or a.enrolled_at is not null)))
         and (public.is_finance() or public.is_guardian_of_family(a.family_id)
              or public.selection_coach_reviews(a.program_id, a.division_id) or public.coach_can_access_athlete(p_athlete)))
    select r.id, r.program_id, p.name, p.season_year::int, d.name, k.name, r.status,
           public.selection_application_tournaments_json(r.id), r.arrangement_kind,
           case when r.money then r.agreed_fee::numeric end, case when r.money then r.monthly_amount::numeric end,
           case when r.money then coalesce(s.currency, r.agreed_currency) end,
           case when r.money then s.amount_due end, case when r.money then s.received end,
           case when r.money then s.balance end, case when r.money then s.next_due_on end,
           case when r.money then coalesce(s.overdue_amount, 0) > 0 end,
           case when r.money then coalesce(s.payment_status, 'none') end,
           r.money, r.accepted_at, r.enrolled_at, r.withdrawn_at, r.withdrawal_reason
      from apps r
      join public.programs p on p.id = r.program_id
      left join public.program_divisions d on d.id = r.division_id
      left join public.program_packages k on k.id = r.package_id
      left join lateral (select * from public.selection_invoice_summary(r.invoice_id)) s on r.invoice_id is not null
     order by p.starts_on desc nulls last, r.created_at desc;
end $$;

-- Staff notice: enrolled players without a confirmed registration and
-- registration failures logged in the last 90 days.
create or replace function public.selection_roster_health(p_program uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if not public.is_finance_of(v_org) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'missing_registrations', coalesce((
      select jsonb_agg(jsonb_build_object('application_id', a.id, 'program_id', a.program_id,
                                          'athlete', btrim(t.first_name || ' ' || t.last_name)) order by t.last_name)
        from public.program_applications a join public.athletes t on t.id = a.athlete_id
       where a.org_id = v_org and a.status = 'enrolled' and (p_program is null or a.program_id = p_program)
         and not exists (select 1 from public.registrations g where g.athlete_id = a.athlete_id and g.program_id = a.program_id
                          and g.camp_edition_id is null and g.status = 'confirmed')), '[]'::jsonb),
    'recent_failures', (
      select count(*) from public.audit_logs l
       where l.org_id = v_org and l.action = 'selection.registration_failed' and l.created_at > now() - interval '90 days'
         and (p_program is null or l.new_data->>'program_id' = p_program::text)));
end $$;

-- Re-run the registration for one enrolled application (staff "fix" button).
create or replace function public.selection_repair_registration(p_application uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare a public.program_applications;
begin
  select * into a from public.program_applications where id = p_application;
  if not found or a.org_id is distinct from public.current_org_id() or not public.selection_is_admin_of(a.org_id) then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  return public.selection_ensure_registration(a.id);
end $$;

-- Grants -----------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.selection_ensure_registration(uuid)',
    'public.selection_apply_arrangement_internal(uuid, text, uuid, numeric, date, text, numeric)',
    'public.selection_issue_invoice(uuid, numeric)',
    'public.selection_set_tournaments_internal(uuid, uuid[], text)',
    'public.selection_invoice_summary(uuid)',
    'public.selection_application_tournaments_json(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
  foreach f in array array[
    'public.selection_arrangement_schedule(numeric, text, numeric, date, text)',
    'public.selection_can_see_money(uuid, uuid)',
    'public.selection_set_arrangement(uuid, text, uuid, numeric, date, text, numeric)',
    'public.selection_division_fits(uuid, date, date)',
    'public.selection_save_enrollment(uuid, jsonb)',
    'public.selection_set_tournaments(uuid, uuid[], text)',
    'public.selection_withdraw_tournament(uuid, uuid, text)',
    'public.selection_staff_add(uuid, uuid, uuid, uuid, uuid[], text, numeric, date, text, text, text, numeric, text, boolean)',
    'public.selection_withdraw_enrollment(uuid, text, date)',
    'public.selection_update_enrollment(uuid, jsonb)',
    'public.selection_move_enrollment(uuid, uuid, uuid, uuid)',
    'public.selection_roster(uuid)',
    'public.selection_athlete_enrollments(uuid)',
    'public.selection_roster_health(uuid)',
    'public.selection_repair_registration(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
