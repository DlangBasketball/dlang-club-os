-- ============================================================================
-- Selection programmes (additive, idempotent)
--
-- A generic capability for programmes that players APPLY to and staff SELECT
-- from (international / representative teams, academies, elite squads,
-- tryout-based teams). Nothing here is club-, sport- or country-specific:
-- a club configures one through data (see scripts/seed-selection-eybl.sh for
-- the founding club's set-up).
--
-- 1. program_kind 'selection' (enum value) and programs.selection_enabled /
--    requires_approval / allow_non_members.
-- 2. program_divisions      age groups of a programme (U14, U16 …): name,
--                           birth-year range and / or "under N" on a cut-off
--                           date, optional team (roster on enrolment),
--                           capacity.
-- 3. program_packages       what a family buys (e.g. "2 tournaments"):
--                           price (currency from the programme / club) and
--                           the instalment counts the family may choose
--                           (any count of the set, 1 = pay in full). These
--                           rules override the club-wide
--                           payment_plan_settings for the package invoice.
-- 4. program_coaches        coaches who review applications (whole
--                           programme or one division), head / assistant.
-- 5. program_applications   applied -> under_review -> accepted | waitlisted
--                           | declined -> enrolled -> withdrawn. Personal
--                           data: audit trigger; read by club finance/admin,
--                           the family's guardians and the programme's
--                           assigned coaches; written only by the RPCs below.
-- 6. RPCs (SECURITY DEFINER, caller and org checked in SQL):
--      selection_apply            guardian, own child (two taps)
--      selection_apply_public     service role, public page (non-members):
--                                 guest family + athlete + consents +
--                                 parent invitation (guest sign-up flow)
--      selection_set_status       admin / assigned coach: review decision,
--                                 division override, note to the family; on
--                                 acceptance the package invoice is issued
--      selection_change_package   guardian / admin, before any payment
--      selection_choose_plan      guardian / finance: pay in full or N
--                                 monthly instalments from today within the
--                                 package's allowed counts (reuses
--                                 plan_create_internal); plan_choose on a
--                                 package invoice is routed here too
--      selection_withdraw         guardian / admin
--      selection_review_list      admin / finance / assigned coach: minimal
--                                 player info (no medical data)
--      selection_program_stats    finance: invoiced, collected, outstanding,
--                                 sponsored, applicants per division
--      selection_report           finance: one row per application
--    Enrolment (status 'enrolled', team roster, registration) happens on the
--    first payment (invoice partially_paid / paid, including an invoice
--    settled by a full sponsorship) or when an instalment plan is set up.
-- 7. Sponsorship: athletes.sponsorship_scope gains 'program'; invoices of an
--    application are scope 'program' (sponsorship_invoice_scope), so the
--    existing deferred trigger adds the "Sponsored (…)" credit note.
-- 8. Feature key 'selection_programs' (Academy tier, add-on).
--
-- Tests: tests/db/selection_programs.sql.
-- ============================================================================

-- 1) Programme kind and flags ----------------------------------------------------
alter type public.program_kind add value if not exists 'selection';

alter table public.programs add column if not exists selection_enabled boolean not null default false;
alter table public.programs add column if not exists requires_approval boolean not null default true;
alter table public.programs add column if not exists allow_non_members boolean not null default true;

comment on column public.programs.selection_enabled is 'Players apply (application, division, package) instead of registering directly.';
comment on column public.programs.requires_approval is 'Selection programmes: a coach / admin accepts each application before the family pays.';
comment on column public.programs.allow_non_members is 'Selection programmes: families who are not club members may apply from the public page.';

-- 2) Divisions --------------------------------------------------------------------
create table if not exists public.program_divisions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  program_id       uuid not null references public.programs(id) on delete cascade,
  name             text not null,
  min_birth_year   integer,
  max_birth_year   integer,
  age_under        integer,
  age_cutoff       date,
  team_id          uuid references public.teams(id) on delete set null,
  capacity         integer,
  sort             integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint program_divisions_chk check (
    char_length(btrim(name)) between 1 and 60
    and (min_birth_year is null or min_birth_year between 1900 and 2200)
    and (max_birth_year is null or max_birth_year between 1900 and 2200)
    and (min_birth_year is null or max_birth_year is null or max_birth_year >= min_birth_year)
    and (age_under is null or age_under between 1 and 99)
    and (capacity is null or capacity between 1 and 10000))
);
create index if not exists idx_program_divisions_org on public.program_divisions(org_id);
create index if not exists idx_program_divisions_program on public.program_divisions(program_id, sort);
create unique index if not exists uq_program_divisions_name on public.program_divisions(program_id, lower(name));

comment on table public.program_divisions is 'Age groups / divisions of a programme (selection programmes).';
comment on column public.program_divisions.age_under is '"Under N": the player is younger than N on age_cutoff (null = today).';

-- 3) Packages ---------------------------------------------------------------------
create table if not exists public.program_packages (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  program_id       uuid not null references public.programs(id) on delete cascade,
  name             text not null,
  description      text,
  price            numeric(12,2) not null,
  allowed_counts   integer[] not null default '{1}',
  show_monthly     boolean not null default true,
  sort             integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint program_packages_chk check (
    char_length(btrim(name)) between 1 and 80
    and (description is null or char_length(description) <= 500)
    and price > 0 and price <= 1000000
    and cardinality(allowed_counts) between 1 and 24
    and allowed_counts <@ array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]::integer[]
    and 1 = any(allowed_counts))
);
create index if not exists idx_program_packages_org on public.program_packages(org_id);
create index if not exists idx_program_packages_program on public.program_packages(program_id, sort);
create unique index if not exists uq_program_packages_name on public.program_packages(program_id, lower(name));

comment on table public.program_packages is 'Packages of a selection programme with their own instalment rules (override payment_plan_settings).';
comment on column public.program_packages.allowed_counts is 'Instalment counts the family may choose; always includes 1 (pay in full).';
comment on column public.program_packages.show_monthly is 'Show "from <price / largest count> per month" on the package.';

-- 4) Coaches of a programme -----------------------------------------------------------
create table if not exists public.program_coaches (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  program_id   uuid not null references public.programs(id) on delete cascade,
  coach_id     uuid not null references public.coaches(id) on delete cascade,
  division_id  uuid references public.program_divisions(id) on delete cascade,
  role         text not null default 'assistant' check (role in ('head', 'assistant')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_program_coaches_org on public.program_coaches(org_id);
create index if not exists idx_program_coaches_coach on public.program_coaches(coach_id);
create unique index if not exists uq_program_coaches
  on public.program_coaches(program_id, coach_id, coalesce(division_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 5) Applications -------------------------------------------------------------------------
create table if not exists public.program_applications (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  program_id         uuid not null references public.programs(id) on delete cascade,
  division_id        uuid references public.program_divisions(id) on delete set null,
  package_id         uuid references public.program_packages(id) on delete set null,
  athlete_id         uuid not null references public.athletes(id) on delete cascade,
  family_id          uuid not null references public.families(id) on delete cascade,
  status             text not null default 'applied',
  is_member          boolean not null default true,
  source             text not null default 'parent',
  current_club       text,
  position           text,
  notes              text,
  video_url          text,
  decision_note      text,
  staff_notes        text,
  invoice_id         uuid references public.invoices(id) on delete set null,
  installment_count  integer,
  applied_by         uuid references public.profiles(id) on delete set null,
  reviewed_by        uuid references public.profiles(id) on delete set null,
  reviewed_at        timestamptz,
  accepted_at        timestamptz,
  enrolled_at        timestamptz,
  withdrawn_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint program_applications_chk check (
    status in ('applied', 'under_review', 'accepted', 'waitlisted', 'declined', 'enrolled', 'withdrawn')
    and source in ('public', 'parent', 'admin')
    and (current_club is null or char_length(current_club) <= 120)
    and (position is null or char_length(position) <= 60)
    and (notes is null or char_length(notes) <= 2000)
    and (video_url is null or (char_length(video_url) <= 500 and video_url ~* '^https://'))
    and (decision_note is null or char_length(decision_note) <= 2000)
    and (staff_notes is null or char_length(staff_notes) <= 2000)
    and (installment_count is null or installment_count between 1 and 24))
);
create index if not exists idx_program_applications_org on public.program_applications(org_id, status);
create index if not exists idx_program_applications_program on public.program_applications(program_id, division_id);
create index if not exists idx_program_applications_family on public.program_applications(family_id);
create index if not exists idx_program_applications_invoice on public.program_applications(invoice_id);
-- One live application per player and programme (a declined / withdrawn one may re-apply).
create unique index if not exists uq_program_applications_live
  on public.program_applications(program_id, athlete_id) where status not in ('declined', 'withdrawn');

comment on table public.program_applications is 'Applications to selection programmes (personal data of minors: audit-logged).';
comment on column public.program_applications.is_member is 'Snapshot at application: the family was a club member (false = programme-only / guest).';
comment on column public.program_applications.decision_note is 'Message to the family with the decision.';
comment on column public.program_applications.staff_notes is 'Internal notes (staff and assigned coaches only).';

-- updated_at + audit ------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['program_divisions', 'program_packages', 'program_coaches', 'program_applications'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$s', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$s for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

drop trigger if exists trg_audit_program_applications on public.program_applications;
create trigger trg_audit_program_applications after insert or update or delete on public.program_applications
  for each row execute function public.audit_trigger();

-- Same-org references (a client can never point at another club's rows).
create or replace function public.selection_same_org_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_prog uuid;
begin
  if not exists (select 1 from public.programs where id = new.program_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: program' using errcode = '42501';
  end if;
  if tg_table_name = 'program_divisions' then
    if new.team_id is not null and not exists (select 1 from public.teams where id = new.team_id and org_id = new.org_id) then
      raise exception 'CROSS_TENANT_REFERENCE: team' using errcode = '42501';
    end if;
  elsif tg_table_name = 'program_coaches' then
    if not exists (select 1 from public.coaches where id = new.coach_id and org_id = new.org_id) then
      raise exception 'CROSS_TENANT_REFERENCE: coach' using errcode = '42501';
    end if;
    if new.division_id is not null then
      select program_id into v_prog from public.program_divisions where id = new.division_id and org_id = new.org_id;
      if v_prog is distinct from new.program_id then raise exception 'CROSS_TENANT_REFERENCE: division' using errcode = '42501'; end if;
    end if;
  elsif tg_table_name = 'program_applications' then
    if not exists (select 1 from public.athletes where id = new.athlete_id and org_id = new.org_id and family_id = new.family_id) then
      raise exception 'CROSS_TENANT_REFERENCE: athlete' using errcode = '42501';
    end if;
    if new.division_id is not null and not exists (
         select 1 from public.program_divisions where id = new.division_id and program_id = new.program_id and org_id = new.org_id) then
      raise exception 'CROSS_TENANT_REFERENCE: division' using errcode = '42501';
    end if;
    if new.package_id is not null and not exists (
         select 1 from public.program_packages where id = new.package_id and program_id = new.program_id and org_id = new.org_id) then
      raise exception 'CROSS_TENANT_REFERENCE: package' using errcode = '42501';
    end if;
    if new.invoice_id is not null and not exists (select 1 from public.invoices where id = new.invoice_id and org_id = new.org_id) then
      raise exception 'CROSS_TENANT_REFERENCE: invoice' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['program_divisions', 'program_packages', 'program_coaches', 'program_applications'] loop
    execute format('drop trigger if exists trg_%1$s_same_org on public.%1$s', t);
    execute format('create trigger trg_%1$s_same_org before insert or update on public.%1$s for each row execute function public.selection_same_org_refs()', t);
  end loop;
end $$;

-- 6) Pure helpers (mirrored in src/lib/selection/rules.ts) ---------------------------------
-- Allowed status changes. Staff decide; the family may only withdraw;
-- 'enrolled' is set by payment / plan set-up (or staff for offline payments).
create or replace function public.selection_transition_ok(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case p_from
    when 'applied'      then p_to in ('under_review', 'accepted', 'waitlisted', 'declined', 'withdrawn')
    when 'under_review' then p_to in ('accepted', 'waitlisted', 'declined', 'withdrawn')
    when 'waitlisted'   then p_to in ('under_review', 'accepted', 'declined', 'withdrawn')
    when 'declined'     then p_to in ('under_review')
    when 'accepted'     then p_to in ('enrolled', 'waitlisted', 'withdrawn')
    when 'enrolled'     then p_to in ('withdrawn')
    else false
  end;
$$;

-- Division for a date of birth: the first active division (by sort, name)
-- whose birth-year range and "under N" rule both match. Null = none.
create or replace function public.selection_suggest_division(p_program uuid, p_dob date, p_today date default current_date)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select d.id from public.program_divisions d
   where d.program_id = p_program and d.is_active and p_dob is not null
     and (d.min_birth_year is null or extract(year from p_dob)::int >= d.min_birth_year)
     and (d.max_birth_year is null or extract(year from p_dob)::int <= d.max_birth_year)
     and (d.age_under is null or extract(year from age(coalesce(d.age_cutoff, p_today), p_dob))::int < d.age_under)
   order by d.sort, lower(d.name)
   limit 1;
$$;

-- Assigned reviewer of a programme (whole programme or that division).
create or replace function public.selection_coach_reviews(p_program uuid, p_division uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.program_coaches pc
      join public.coaches c on c.id = pc.coach_id
     where pc.program_id = p_program
       and c.profile_id = auth.uid()
       and pc.org_id = public.current_org_id()
       and (pc.division_id is null or p_division is null or pc.division_id = p_division));
$$;

-- Head coach of the programme (may sponsor applicants).
create or replace function public.selection_head_coach(p_program uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.program_coaches pc join public.coaches c on c.id = pc.coach_id
     where pc.program_id = p_program and pc.role = 'head' and c.profile_id = auth.uid()
       and pc.org_id = public.current_org_id());
$$;

-- Admin of the programme's club (decisions) — finance reads and bills.
create or replace function public.selection_is_admin_of(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org is not null and p_org = public.current_org_id() and public.is_admin();
$$;

-- 7) RLS ---------------------------------------------------------------------------------------------
alter table public.program_divisions    enable row level security;
alter table public.program_packages     enable row level security;
alter table public.program_coaches      enable row level security;
alter table public.program_applications enable row level security;

do $$
declare t text;
begin
  -- Set-up tables: members of the club read (shown when applying), admins write.
  foreach t in array array['program_divisions', 'program_packages', 'program_coaches'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select using (org_id = public.current_org_id())', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert with check (org_id = public.current_org_id() and public.is_admin())', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update using (org_id = public.current_org_id() and public.is_admin()) with check (org_id = public.current_org_id() and public.is_admin())', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_delete on public.%1$s for delete using (org_id = public.current_org_id() and public.is_admin())', t);
  end loop;
  foreach t in array array['program_divisions', 'program_packages', 'program_coaches', 'program_applications'] loop
    execute format('drop policy if exists platform_tenant_isolation on public.%1$s', t);
    execute format('create policy platform_tenant_isolation on public.%1$s as restrictive for all using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()))', t);
  end loop;
end $$;

-- Applications: staff of the club, the family's guardians, the programme's
-- assigned coaches. Writes only through the RPCs below.
drop policy if exists program_applications_select on public.program_applications;
create policy program_applications_select on public.program_applications for select
  using (org_id = public.current_org_id()
         and (public.is_finance() or public.is_guardian_of_family(family_id)
              or public.selection_coach_reviews(program_id, division_id)));
drop policy if exists program_applications_insert on public.program_applications;
create policy program_applications_insert on public.program_applications for insert with check (false);
drop policy if exists program_applications_update on public.program_applications;
create policy program_applications_update on public.program_applications for update using (false) with check (false);
drop policy if exists program_applications_delete on public.program_applications;
create policy program_applications_delete on public.program_applications for delete using (false);

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on public.program_divisions, public.program_packages, public.program_coaches to authenticated;
    grant select on public.program_applications to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.program_divisions, public.program_packages, public.program_coaches, public.program_applications to service_role;
  end if;
end $$;

-- 8) Sponsorship scope 'program' ----------------------------------------------------------------
alter table public.athletes drop constraint if exists athletes_sponsorship_chk;
alter table public.athletes add constraint athletes_sponsorship_chk check (
  sponsorship_kind in ('none', 'full', 'partial')
  and (sponsorship_percent is null or (sponsorship_percent >= 1 and sponsorship_percent <= 100))
  and (sponsorship_kind <> 'partial' or sponsorship_percent is not null)
  and (sponsorship_kind <> 'full' or sponsorship_percent = 100)
  and (sponsorship_kind <> 'none' or sponsorship_percent is null)
  and sponsorship_scope <@ array['season', 'recurring', 'membership', 'camp', 'training', 'shop', 'program', 'all']::text[]
  and (sponsorship_kind = 'none' or cardinality(sponsorship_scope) >= 1)
  and (sponsor_name is null or char_length(sponsor_name) <= 120)
  and (sponsorship_reason is null or char_length(sponsorship_reason) <= 300)
  and (sponsorship_from is null or sponsorship_until is null or sponsorship_until >= sponsorship_from));

alter table public.athlete_sponsorship_entries drop constraint if exists athlete_sponsorship_entries_chk;
alter table public.athlete_sponsorship_entries add constraint athlete_sponsorship_entries_chk check (
  scope in ('season', 'recurring', 'membership', 'camp', 'training', 'shop', 'program')
  and method in ('invoice_line', 'credit_note', 'cancellation', 'waived')
  and sponsorship_kind in ('full', 'partial')
  and percent > 0 and percent <= 100
  and amount > 0 and list_amount >= amount
  and currency ~ '^[A-Z]{3}$'
  and (sponsor_name is null or char_length(sponsor_name) <= 120)
  and coalesce(length(void_reason), 0) <= 500);

comment on column public.athletes.sponsorship_scope is 'Fees covered: season, recurring, membership, camp, training, shop, program (selection programmes), all.';

-- Body from 20250420102400_sponsored_players.sql plus the 'program' branch.
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
  if exists (select 1 from public.program_applications where invoice_id = p_invoice) then return 'program'; end if;
  if exists (select 1 from public.payment_plan_installments i join public.payment_plans p on p.id = i.plan_id
              where i.invoice_id = p_invoice and p.kind = 'recurring') then return 'recurring'; end if;
  if exists (select 1 from public.memberships where invoice_id = p_invoice) then return 'membership'; end if;
  if v.program_id is not null then
    return case when (select kind::text from public.programs where id = v.program_id) = 'camp' then 'camp' else 'season' end;
  end if;
  return null;
end $$;

-- 9) Billing internals ----------------------------------------------------------------------------
-- Issue the package invoice of an accepted application (one line; the
-- sponsorship trigger adds the sponsored share at the end of the transaction).
create or replace function public.selection_issue_invoice(p_application uuid)
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
  select * into pkg from public.program_packages where id = a.package_id;
  select * into prog from public.programs where id = a.program_id;
  select name into v_div from public.program_divisions where id = a.division_id;
  v_cur := upper(coalesce(nullif(prog.currency, ''), (select currency from public.app_settings where org_id = a.org_id),
                          (select currency from public.organizations where id = a.org_id), 'CHF'));
  v_desc := left(prog.name || ' · ' || pkg.name || coalesce(' · ' || v_div, ''), 500);
  v_num := public.next_invoice_number(a.org_id);
  insert into public.invoices (org_id, number, family_id, athlete_id, program_id, description, status, due_date, currency, total_chf)
  values (a.org_id, v_num, a.family_id, a.athlete_id, a.program_id, v_desc, 'sent', current_date + 14, v_cur, pkg.price)
  returning id into v_inv;
  insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
  values (a.org_id, v_inv, v_desc, 1, pkg.price, pkg.price);
  update public.program_applications set invoice_id = v_inv where id = a.id;
  return v_inv;
end $$;

-- Cancel an application's open, unpaid invoice (package change / withdrawal).
-- Returns false when money was received (finance refunds by hand).
create or replace function public.selection_cancel_invoice(p_invoice uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v public.invoices;
begin
  select * into v from public.invoices where id = p_invoice for update;
  if not found then return true; end if;
  if v.status::text in ('cancelled', 'void') then return true; end if;
  if public.invoice_net_paid(v.id) > 0 then return false; end if;
  if v.status::text = 'paid' and not exists (
       select 1 from public.athlete_sponsorship_entries where invoice_id = v.id and voided_at is null) then
    return false;
  end if;
  update public.payment_plan_installments set status = 'cancelled'
   where invoice_id = v.id and status = 'scheduled'
     and plan_id in (select id from public.payment_plans where invoice_id = v.id and kind = 'installments');
  update public.payment_plans set status = 'cancelled', cancel_reason = left(p_reason, 500)
   where invoice_id = v.id and kind = 'installments' and status in ('active', 'paused');
  update public.athlete_sponsorship_entries set voided_at = now(), void_reason = left(p_reason, 500)
   where invoice_id = v.id and voided_at is null;
  update public.invoices set status = 'cancelled', cancelled_at = now(), cancel_reason = left(p_reason, 500), paid_at = null
   where id = v.id;
  return true;
end $$;

-- Enrolment: status, team roster of the division, programme registration.
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
  -- The programme registration (existing rosters, coach access, counts).
  -- Never blocks the enrolment (programme rules / capacity are the
  -- application's business here).
  begin
    insert into public.registrations (org_id, athlete_id, program_id, status, invoice_id)
    values (a.org_id, a.athlete_id, a.program_id, 'confirmed', a.invoice_id)
    on conflict (athlete_id, program_id) do update set status = 'confirmed';
  exception when others then
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
    values (a.org_id, auth.uid(), 'selection.registration_skipped', 'program_applications', a.id,
            jsonb_build_object('error', left(sqlerrm, 300)));
  end;
end $$;

-- First payment (or a settled sponsored invoice) enrols an accepted application.
create or replace function public.invoices_selection_enroll()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  for r in select id from public.program_applications where invoice_id = new.id and status = 'accepted' loop
    perform public.selection_enroll_internal(r.id);
  end loop;
  return null;
end $$;

drop trigger if exists trg_invoices_selection_enroll on public.invoices;
create trigger trg_invoices_selection_enroll
  after update of status on public.invoices
  for each row
  when (new.status::text in ('paid', 'partially_paid') and old.status is distinct from new.status)
  execute function public.invoices_selection_enroll();

-- Monthly due dates from p_start (first instalment on p_start), clamped to month ends.
create or replace function public.selection_due_dates(p_start date, p_count int)
returns date[]
language sql
immutable
set search_path = public
as $$
  select array_agg(public.plan_month_day(extract(year from p_start)::int, extract(month from p_start)::int, k,
                                          extract(day from p_start)::int) order by k)
    from generate_series(0, greatest(p_count, 1) - 1) k;
$$;

-- Package rules on one invoice (locked by the caller or locked here).
create or replace function public.selection_plan_internal(p_invoice uuid, p_count int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v      public.invoices;
  a      public.program_applications;
  pkg    public.program_packages;
  v_bal  numeric;
  v_dts  date[];
  v_amts numeric[];
  v_plan uuid;
begin
  select * into v from public.invoices where id = p_invoice for update;
  if not found then raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into a from public.program_applications where invoice_id = p_invoice order by created_at desc limit 1;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if a.status not in ('accepted', 'enrolled') then raise exception 'NOT_ACCEPTED' using errcode = 'P0001'; end if;
  select * into pkg from public.program_packages where id = a.package_id;
  if not found then raise exception 'PACKAGE_REQUIRED' using errcode = 'P0001'; end if;
  if p_count is null or not (p_count = any(pkg.allowed_counts)) then raise exception 'COUNT_NOT_ALLOWED' using errcode = 'P0001'; end if;
  if v.status::text = 'draft' then raise exception 'INVOICE_IS_DRAFT' using errcode = 'P0001'; end if;
  if v.status::text in ('cancelled', 'void', 'refunded', 'written_off') then raise exception 'INVOICE_NOT_PAYABLE' using errcode = 'P0001'; end if;
  if exists (select 1 from public.payment_plans where invoice_id = p_invoice and kind = 'installments' and status in ('active', 'paused')) then
    raise exception 'PLAN_EXISTS' using errcode = 'P0001';
  end if;

  if p_count = 1 then
    update public.program_applications set installment_count = 1 where id = a.id;
    return jsonb_build_object('invoice_id', v.id, 'count', 1, 'plan_id', null);
  end if;

  v_bal := public.invoice_amount_due(p_invoice) - public.invoice_net_paid(p_invoice);
  if v_bal <= 0 then raise exception 'NOTHING_OUTSTANDING' using errcode = 'P0001'; end if;
  v_dts := public.selection_due_dates(current_date, p_count);
  select array_agg(round(x, public.currency_exponent(v.currency)) order by n) into v_amts
    from unnest(public.plan_split(v_bal, p_count, v.currency)) with ordinality as u(x, n);
  v_plan := public.plan_create_internal(v, v_dts, v_amts, 0, 'invoice', 'monthly');
  update public.program_applications set installment_count = p_count where id = a.id;
  if a.status = 'accepted' then perform public.selection_enroll_internal(a.id); end if;
  return jsonb_build_object('invoice_id', v.id, 'count', p_count, 'plan_id', v_plan,
                            'dates', to_jsonb(v_dts), 'amounts', to_jsonb(v_amts));
end $$;

-- plan_choose / plan_attach_checkout on a package invoice follow the
-- package's rules. Body from 20250420101000_instalments_recurring_autopay.sql
-- plus the first branch.
create or replace function public.plan_choose_internal(p_invoice uuid, p_org uuid, p_count int, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v        public.invoices;
  s        public.payment_plan_settings;
  v_bal    numeric;
  v_fee    numeric;
  v_type   text;
  v_start  date;
  v_dates  date[];
  v_amts   numeric[];
  v_plan   uuid;
begin
  select * into v from public.invoices where id = p_invoice and org_id = p_org for update;
  if not found then raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if exists (select 1 from public.program_applications where invoice_id = p_invoice) then
    return public.selection_plan_internal(p_invoice, p_count);
  end if;
  if v.status::text = 'draft' then raise exception 'INVOICE_IS_DRAFT' using errcode = 'P0001'; end if;
  if v.status::text in ('paid','cancelled','void','refunded','written_off') then raise exception 'INVOICE_NOT_PAYABLE' using errcode = 'P0001'; end if;
  if exists (select 1 from public.payment_plans where invoice_id = p_invoice and kind = 'installments' and status in ('active','paused')) then
    raise exception 'PLAN_EXISTS' using errcode = 'P0001';
  end if;

  s := public.plan_settings(p_org);
  if not s.enabled then raise exception 'PLANS_DISABLED' using errcode = 'P0001'; end if;
  v_type := public.invoice_product_type(p_invoice);
  if not (v_type = any(s.product_types) or 'invoice' = any(s.product_types)) then
    raise exception 'PRODUCT_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;
  if p_count is null or not (p_count = any(s.allowed_counts)) then raise exception 'COUNT_NOT_ALLOWED' using errcode = 'P0001'; end if;

  v_bal := public.invoice_amount_due(p_invoice) - public.invoice_net_paid(p_invoice);
  if v_bal <= 0 then raise exception 'NOTHING_OUTSTANDING' using errcode = 'P0001'; end if;
  if v_bal < s.min_amount then raise exception 'BELOW_MINIMUM' using errcode = 'P0001'; end if;

  v_dates := public.plan_due_dates(current_date, p_count, s.first_at_signup, s.schedule_kind, s.day_of_month, s.custom_dates);
  if v_dates is null then raise exception 'SCHEDULE_UNAVAILABLE' using errcode = 'P0001'; end if;
  if v_type = 'camp' and s.camp_last_days_before is not null then
    v_start := public.invoice_activity_start(p_invoice);
    if v_start is not null and v_dates[p_count] > v_start - s.camp_last_days_before then
      raise exception 'LAST_AFTER_DEADLINE' using errcode = 'P0001';
    end if;
  end if;

  v_fee := public.plan_fee(s.fee_kind, s.fee_value, v_bal, v.currency);
  v_amts := public.plan_split(v_bal + v_fee, p_count, v.currency);
  v_plan := public.plan_create_internal(v, v_dates, v_amts, v_fee,
    coalesce(p_source, case when v_type in ('season','camp','training_package','shop','recurring') then v_type else 'invoice' end),
    s.schedule_kind);
  return jsonb_build_object('plan_id', v_plan, 'invoice_id', p_invoice, 'fee', v_fee,
                            'dates', to_jsonb(v_dates), 'amounts', to_jsonb(v_amts));
end;
$$;

-- 10) Applying ------------------------------------------------------------------------------------------
-- Shared by the parent app and the public page (caller checks done by the wrappers).
create or replace function public.selection_apply_internal(
  p_org uuid, p_program uuid, p_athlete uuid, p_division uuid, p_package uuid, p_payload jsonb, p_source text, p_by uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  prog   public.programs;
  ath    public.athletes;
  v_fam  public.families;
  v_div  uuid := p_division;
  v_id   uuid;
  v_vid  text := nullif(btrim(coalesce(p_payload->>'video_url', '')), '');
begin
  select * into prog from public.programs where id = p_program and org_id = p_org;
  if not found or not prog.selection_enabled or not prog.is_active or prog.status <> 'published' then
    raise exception 'PROGRAM_NOT_OPEN' using errcode = 'P0001';
  end if;
  if (prog.registration_opens_at is not null and now() < prog.registration_opens_at)
     or (prog.registration_closes_at is not null and now() >= prog.registration_closes_at) then
    raise exception 'REGISTRATION_CLOSED' using errcode = 'P0001';
  end if;
  select * into ath from public.athletes where id = p_athlete and org_id = p_org;
  if not found or ath.status = 'archived' then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_fam from public.families where id = ath.family_id;
  if p_source = 'public' and not prog.allow_non_members and coalesce(v_fam.membership_status, 'member') <> 'member' then
    raise exception 'MEMBERS_ONLY' using errcode = 'P0001';
  end if;
  if v_div is null then v_div := public.selection_suggest_division(p_program, ath.dob); end if;
  if v_div is not null and not exists (select 1 from public.program_divisions where id = v_div and program_id = p_program and is_active) then
    raise exception 'DIVISION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_div is null and exists (select 1 from public.program_divisions where program_id = p_program and is_active) then
    raise exception 'DIVISION_REQUIRED' using errcode = 'P0001';
  end if;
  if p_package is null or not exists (select 1 from public.program_packages where id = p_package and program_id = p_program and is_active) then
    raise exception 'PACKAGE_REQUIRED' using errcode = 'P0001';
  end if;
  if v_vid is not null and v_vid !~* '^https://' then raise exception 'INVALID_VIDEO_URL' using errcode = 'P0001'; end if;
  if exists (select 1 from public.program_applications
              where program_id = p_program and athlete_id = p_athlete and status not in ('declined', 'withdrawn')) then
    raise exception 'ALREADY_APPLIED' using errcode = 'P0001';
  end if;

  insert into public.program_applications
    (org_id, program_id, division_id, package_id, athlete_id, family_id, status, is_member, source,
     current_club, position, notes, video_url, applied_by)
  values (p_org, p_program, v_div, p_package, p_athlete, ath.family_id, 'applied',
          coalesce(v_fam.membership_status, 'member') = 'member', p_source,
          left(nullif(btrim(coalesce(p_payload->>'current_club', '')), ''), 120),
          left(nullif(btrim(coalesce(p_payload->>'position', '')), ''), 60),
          left(nullif(btrim(coalesce(p_payload->>'notes', '')), ''), 2000),
          left(v_vid, 500), p_by)
  returning id into v_id;

  -- No approval step: accepted at once, the package invoice follows.
  if not prog.requires_approval then
    update public.program_applications set status = 'accepted', accepted_at = now() where id = v_id;
    perform public.selection_issue_invoice(v_id);
  end if;
  return v_id;
end $$;

-- Guardian (parent app): own child, current club.
create or replace function public.selection_apply(
  p_program uuid, p_athlete uuid, p_division uuid, p_package uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id(); v_id uuid;
begin
  if v_org is null or not public.is_guardian_of_athlete(p_athlete) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.programs where id = p_program and org_id = v_org) then
    raise exception 'PROGRAM_NOT_OPEN' using errcode = 'P0001';
  end if;
  v_id := public.selection_apply_internal(v_org, p_program, p_athlete, p_division, p_package, coalesce(p_payload, '{}'::jsonb), 'parent', auth.uid());
  return (select jsonb_build_object('application_id', id, 'status', status, 'invoice_id', invoice_id, 'division_id', division_id)
            from public.program_applications where id = v_id);
end $$;

-- Service role (public page): the org is the programme's own (resolved
-- server-side from the slug), never a client value. Creates the guest
-- family / athlete like the public camp checkout, records the consents and
-- the parent invitation (guest sign-up links the new login to this family).
create or replace function public.selection_apply_public(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prog      public.programs;
  v_email   text := lower(btrim(coalesce(p_payload->'parent'->>'email', '')));
  v_child   jsonb := coalesce(p_payload->'child', '{}'::jsonb);
  v_dob     date;
  v_family  uuid;
  v_member  text;
  v_athlete uuid;
  v_id      uuid;
  v_consent text;
  v_form    record;
  v_ip      inet;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into prog from public.programs where id = nullif(p_payload->>'program_id', '')::uuid;
  if not found or not prog.is_public or not prog.selection_enabled then raise exception 'PROGRAM_NOT_OPEN' using errcode = 'P0001'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_EMAIL' using errcode = 'P0001'; end if;
  if nullif(btrim(coalesce(v_child->>'first_name', '')), '') is null or nullif(btrim(coalesce(v_child->>'last_name', '')), '') is null then
    raise exception 'INVALID_CHILD' using errcode = 'P0001';
  end if;
  begin v_dob := (v_child->>'dob')::date; exception when others then v_dob := null; end;
  if v_dob is null or v_dob >= current_date then raise exception 'INVALID_CHILD' using errcode = 'P0001'; end if;
  if public.org_requires_vpc(prog.org_id) and v_dob > (current_date - interval '13 years') then
    raise exception 'VPC_REQUIRED' using errcode = 'P0001';
  end if;
  begin v_ip := nullif(p_payload->>'ip', '')::inet; exception when others then v_ip := null; end;

  select id, membership_status into v_family, v_member from public.families
   where org_id = prog.org_id and lower(contact_email) = v_email order by created_at limit 1;
  if v_family is null then
    if not prog.allow_non_members then raise exception 'MEMBERS_ONLY' using errcode = 'P0001'; end if;
    insert into public.families (org_id, name, address, phone, contact_name, contact_email, membership_status)
    values (prog.org_id, left(coalesce(nullif(btrim(p_payload->'parent'->>'name'), ''), v_email) || ' family', 120),
            nullif(p_payload->'parent'->>'address', ''), nullif(p_payload->'parent'->>'phone', ''),
            nullif(p_payload->'parent'->>'name', ''), v_email, 'guest')
    returning id into v_family;
  end if;

  -- The same child applying again from the public page is the same athlete.
  select id into v_athlete from public.athletes
   where org_id = prog.org_id and family_id = v_family and dob = v_dob
     and lower(first_name) = lower(btrim(v_child->>'first_name')) and lower(last_name) = lower(btrim(v_child->>'last_name'))
     and status <> 'archived'
   limit 1;
  if v_athlete is null then
    insert into public.athletes (org_id, family_id, first_name, last_name, dob, gender, position_pref, status)
    values (prog.org_id, v_family, btrim(v_child->>'first_name'), btrim(v_child->>'last_name'), v_dob,
            nullif(v_child->>'gender', ''), left(nullif(btrim(coalesce(p_payload->>'position', '')), ''), 60), 'active')
    returning id into v_athlete;
    insert into public.athlete_medical (org_id, athlete_id, emergency_contact_name, emergency_contact_phone)
    values (prog.org_id, v_athlete, nullif(p_payload->'parent'->>'emergency_name', ''), nullif(p_payload->'parent'->>'emergency_phone', ''))
    on conflict (athlete_id) do nothing;
  end if;

  v_id := public.selection_apply_internal(prog.org_id, prog.id, v_athlete, nullif(p_payload->>'division_id', '')::uuid,
                                          nullif(p_payload->>'package_id', '')::uuid, p_payload, 'public', null);

  -- Consents: latest active version per key.
  if jsonb_typeof(p_payload->'consents') = 'array' then
    for v_consent in select jsonb_array_elements_text(p_payload->'consents') loop
      select id, version into v_form from public.consent_forms
       where org_id = prog.org_id and key = v_consent and is_active order by version desc limit 1;
      if v_form.id is not null then
        insert into public.consent_acceptances (org_id, athlete_id, consent_form_id, accepted_version, status, program_id, ip_address)
        values (prog.org_id, v_athlete, v_form.id, v_form.version, 'accepted', prog.id, v_ip);
      end if;
    end loop;
  end if;

  if not exists (select 1 from public.invitations where org_id = prog.org_id and email = v_email and status = 'pending')
     and not exists (select 1 from public.family_members fm join public.profiles p on p.id = fm.profile_id
                      where fm.family_id = v_family and lower(p.email) = v_email) then
    insert into public.invitations (org_id, email, role, family_id, status, expires_at)
    values (prog.org_id, v_email, 'parent', v_family, 'pending', now() + interval '30 days');
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (prog.org_id, null, 'selection.applied_public', 'program_applications', v_id,
          jsonb_build_object('program_id', prog.id, 'family_id', v_family, 'guest', coalesce(v_member, 'guest') <> 'member'));

  return (select jsonb_build_object('application_id', a.id, 'status', a.status, 'invoice_id', a.invoice_id,
                                    'family_id', a.family_id, 'athlete_id', a.athlete_id, 'division_id', a.division_id,
                                    'org_id', a.org_id)
            from public.program_applications a where a.id = v_id);
end $$;

-- 11) Decisions, package changes, plans, withdrawal --------------------------------------------------------
create or replace function public.selection_set_status(
  p_application uuid, p_status text, p_note text default null, p_division uuid default null, p_staff_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a      public.program_applications;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into a from public.program_applications where id = p_application for update;
  if not found or a.org_id is distinct from public.current_org_id()
     or not (public.selection_is_admin_of(a.org_id) or public.selection_coach_reviews(a.program_id, a.division_id)) then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_division is not null and p_division is distinct from a.division_id then
    if not exists (select 1 from public.program_divisions where id = p_division and program_id = a.program_id and org_id = a.org_id) then
      raise exception 'DIVISION_NOT_FOUND' using errcode = 'P0001';
    end if;
    update public.program_applications set division_id = p_division where id = a.id;
  end if;
  if p_staff_notes is not null then
    update public.program_applications set staff_notes = left(nullif(btrim(p_staff_notes), ''), 2000) where id = a.id;
  end if;

  if p_status is not null and p_status <> a.status then
    if not public.selection_transition_ok(a.status, p_status) then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
    if p_status = 'declined' and v_note is null then raise exception 'NOTE_REQUIRED' using errcode = 'P0001'; end if;
    if p_status = 'enrolled' and not public.selection_is_admin_of(a.org_id) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
    if p_status = 'withdrawn' then
      return public.selection_withdraw(a.id, v_note);
    end if;
    update public.program_applications
       set status = p_status, decision_note = coalesce(v_note, decision_note),
           reviewed_by = auth.uid(), reviewed_at = now(),
           accepted_at = case when p_status = 'accepted' then now() else accepted_at end
     where id = a.id;
    if p_status = 'accepted' and (a.invoice_id is null
         or (select status::text from public.invoices where id = a.invoice_id) in ('cancelled', 'void')) then
      perform public.selection_issue_invoice(a.id);
    elsif p_status = 'waitlisted' and a.invoice_id is not null then
      if public.selection_cancel_invoice(a.invoice_id, 'Waitlisted') then
        update public.program_applications set invoice_id = null, installment_count = null where id = a.id;
      end if;
    elsif p_status = 'enrolled' then
      update public.program_applications set status = 'accepted' where id = a.id;
      perform public.selection_enroll_internal(a.id);
    end if;
  elsif v_note is not null then
    update public.program_applications set decision_note = v_note where id = a.id;
  end if;

  return (select jsonb_build_object('application_id', id, 'status', status, 'invoice_id', invoice_id,
                                    'family_id', family_id, 'division_id', division_id, 'previous_status', a.status)
            from public.program_applications where id = a.id);
end $$;

create or replace function public.selection_change_package(p_application uuid, p_package uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public.program_applications; v_old uuid;
begin
  select * into a from public.program_applications where id = p_application for update;
  if not found or a.org_id is distinct from public.current_org_id()
     or not (public.is_finance_of(a.org_id) or public.is_guardian_of_family(a.family_id)) then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if a.status not in ('applied', 'under_review', 'waitlisted', 'accepted') then raise exception 'PACKAGE_LOCKED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.program_packages where id = p_package and program_id = a.program_id and is_active) then
    raise exception 'PACKAGE_REQUIRED' using errcode = 'P0001';
  end if;
  if p_package = a.package_id then
    return jsonb_build_object('application_id', a.id, 'invoice_id', a.invoice_id, 'changed', false);
  end if;
  v_old := a.invoice_id;
  if v_old is not null then
    if public.invoice_net_paid(v_old) > 0
       or exists (select 1 from public.payment_plans where invoice_id = v_old and kind = 'installments' and status in ('active', 'paused', 'completed')) then
      raise exception 'PACKAGE_LOCKED' using errcode = 'P0001';
    end if;
    if not public.selection_cancel_invoice(v_old, 'Package changed') then raise exception 'PACKAGE_LOCKED' using errcode = 'P0001'; end if;
  end if;
  update public.program_applications set package_id = p_package, invoice_id = null, installment_count = null where id = a.id;
  if a.status = 'accepted' then perform public.selection_issue_invoice(a.id); end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (a.org_id, auth.uid(), 'selection.package_changed', 'program_applications', a.id,
          jsonb_build_object('package_id', a.package_id, 'invoice_id', v_old),
          jsonb_build_object('package_id', p_package));
  return (select jsonb_build_object('application_id', id, 'invoice_id', invoice_id, 'changed', true)
            from public.program_applications where id = a.id);
end $$;

create or replace function public.selection_choose_plan(p_application uuid, p_count int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public.program_applications;
begin
  select * into a from public.program_applications where id = p_application;
  if not found or a.org_id is distinct from public.current_org_id()
     or not (public.is_finance_of(a.org_id) or public.is_guardian_of_family(a.family_id)) then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if a.invoice_id is null then raise exception 'NOT_ACCEPTED' using errcode = 'P0001'; end if;
  return public.selection_plan_internal(a.invoice_id, p_count);
end $$;

create or replace function public.selection_withdraw(p_application uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public.program_applications; v_team uuid; v_cancelled boolean := true;
begin
  select * into a from public.program_applications where id = p_application for update;
  if not found or a.org_id is distinct from public.current_org_id()
     or not (public.selection_is_admin_of(a.org_id) or public.is_guardian_of_family(a.family_id)
             or public.selection_coach_reviews(a.program_id, a.division_id)) then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.selection_transition_ok(a.status, 'withdrawn') then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
  if a.invoice_id is not null then v_cancelled := public.selection_cancel_invoice(a.invoice_id, 'Application withdrawn'); end if;
  update public.program_applications
     set status = 'withdrawn', withdrawn_at = now(),
         decision_note = coalesce(left(nullif(btrim(coalesce(p_note, '')), ''), 2000), decision_note)
   where id = a.id;
  select team_id into v_team from public.program_divisions where id = a.division_id;
  if v_team is not null then
    update public.team_memberships set status = 'inactive', left_on = greatest(joined_on, current_date)
     where team_id = v_team and athlete_id = a.athlete_id and status <> 'inactive';
  end if;
  update public.registrations set status = 'cancelled'
   where program_id = a.program_id and athlete_id = a.athlete_id and status in ('pending', 'confirmed');
  return jsonb_build_object('application_id', a.id, 'status', 'withdrawn', 'previous_status', a.status,
                            'family_id', a.family_id, 'invoice_cancelled', v_cancelled, 'invoice_id', a.invoice_id);
end $$;

-- 12) Reading ----------------------------------------------------------------------------------------------
-- Review list: minimal player data (no medical, no contact details).
create or replace function public.selection_review_list(p_program uuid)
returns table (
  application_id uuid, status text, division_id uuid, division_name text, package_id uuid, package_name text,
  athlete_id uuid, first_name text, last_name text, birth_year int, dob date, player_position text, current_club text,
  notes text, video_url text, is_member boolean, decision_note text, staff_notes text, invoice_id uuid,
  installment_count int, sponsorship_kind text, sponsorship_percent numeric, applied_at timestamptz, reviewed_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if not exists (select 1 from public.programs where id = p_program and org_id = v_org) then return; end if;
  return query
    select a.id, a.status, a.division_id, d.name, a.package_id, k.name,
           a.athlete_id, t.first_name, t.last_name, extract(year from t.dob)::int,
           case when public.is_finance() or public.selection_coach_reviews(a.program_id, a.division_id) then t.dob end,
           a.position, a.current_club, a.notes, a.video_url, a.is_member, a.decision_note, a.staff_notes, a.invoice_id,
           a.installment_count, t.sponsorship_kind,
           case when 'program' = any(t.sponsorship_scope) or 'all' = any(t.sponsorship_scope) then t.sponsorship_percent end,
           a.created_at, a.reviewed_at
      from public.program_applications a
      join public.athletes t on t.id = a.athlete_id
      left join public.program_divisions d on d.id = a.division_id
      left join public.program_packages k on k.id = a.package_id
     where a.program_id = p_program and a.org_id = v_org
       and (public.is_finance() or public.selection_coach_reviews(a.program_id, a.division_id))
     order by case a.status when 'applied' then 0 when 'under_review' then 1 when 'waitlisted' then 2 when 'accepted' then 3
                            when 'enrolled' then 4 when 'declined' then 5 else 6 end, a.created_at;
end $$;

-- Programme revenue and pipeline (finance / admin of the club).
create or replace function public.selection_program_stats(p_program uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id(); v_out jsonb;
begin
  if not public.is_finance_of(v_org) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  with progs as (
    select p.* from public.programs p
     where p.org_id = v_org and (p.selection_enabled or p.kind::text = 'selection')
       and (p_program is null or p.id = p_program)
  ), inv as (
    select i.program_id, i.id, i.total_chf,
           public.invoice_net_paid(i.id) as paid,
           greatest(public.invoice_amount_due(i.id) - public.invoice_net_paid(i.id), 0) as open,
           i.status::text as status
      from public.invoices i join progs p on p.id = i.program_id
     where i.org_id = v_org and i.status::text not in ('draft', 'cancelled', 'void')
  ), money as (
    select inv.program_id,
           coalesce(sum(inv.total_chf), 0) as invoiced,
           coalesce(sum(inv.paid), 0) as collected,
           coalesce(sum(case when inv.status in ('written_off', 'refunded') then 0 else inv.open end), 0) as outstanding,
           coalesce(sum((select coalesce(sum(e.amount), 0) from public.athlete_sponsorship_entries e
                           where e.invoice_id = inv.id and e.voided_at is null)), 0) as sponsored
      from inv group by inv.program_id
  ), divs as (
    select a.program_id, a.division_id, coalesce(d.name, '') as name, coalesce(d.sort, 9999) as sort,
           count(*) filter (where a.status <> 'withdrawn') as applicants,
           count(*) filter (where a.status in ('applied', 'under_review')) as pending,
           count(*) filter (where a.status in ('accepted', 'enrolled')) as accepted,
           count(*) filter (where a.status = 'enrolled') as enrolled,
           count(*) filter (where a.status = 'waitlisted') as waitlisted,
           count(*) filter (where a.status = 'declined') as declined
      from public.program_applications a join progs p on p.id = a.program_id
      left join public.program_divisions d on d.id = a.division_id
     group by a.program_id, a.division_id, d.name, d.sort
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'program_id', p.id, 'name', p.name, 'slug', p.slug, 'season_year', p.season_year,
           'currency', upper(coalesce(nullif(p.currency, ''), (select currency from public.app_settings where org_id = v_org), 'CHF')),
           'invoiced', coalesce(m.invoiced, 0), 'collected', coalesce(m.collected, 0),
           'outstanding', coalesce(m.outstanding, 0), 'sponsored', coalesce(m.sponsored, 0),
           'applicants', coalesce((select sum(applicants) from divs where divs.program_id = p.id), 0),
           'accepted', coalesce((select sum(accepted) from divs where divs.program_id = p.id), 0),
           'enrolled', coalesce((select sum(enrolled) from divs where divs.program_id = p.id), 0),
           'divisions', coalesce((select jsonb_agg(jsonb_build_object('division_id', d.division_id, 'name', d.name,
                                     'applicants', d.applicants, 'pending', d.pending, 'accepted', d.accepted,
                                     'enrolled', d.enrolled, 'waitlisted', d.waitlisted, 'declined', d.declined)
                                   order by d.sort, d.name)
                                    from divs d where d.program_id = p.id), '[]'::jsonb))
         order by p.starts_on desc nulls last, p.name), '[]'::jsonb)
    into v_out
    from progs p left join money m on m.program_id = p.id;
  return v_out;
end $$;

-- Finance report: one row per application (filters optional).
create or replace function public.selection_report(
  p_program uuid default null, p_season int default null, p_division uuid default null, p_package uuid default null)
returns table (
  application_id uuid, program_id uuid, program_name text, season_year int, division_name text, package_name text,
  athlete_name text, birth_year int, family_name text, is_member boolean, current_club text, status text,
  currency text, invoice_number text, invoiced numeric, sponsored numeric, collected numeric, outstanding numeric,
  installment_count int, applied_at timestamptz, accepted_at timestamptz, enrolled_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if not public.is_finance_of(v_org) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return query
    select a.id, p.id, p.name, p.season_year::int, d.name, k.name,
           btrim(t.first_name || ' ' || t.last_name), extract(year from t.dob)::int, f.name, a.is_member, a.current_club, a.status,
           coalesce(i.currency, upper(coalesce(nullif(p.currency, ''), 'CHF'))), i.number,
           coalesce(case when i.status::text in ('cancelled', 'void', 'draft') then 0 else i.total_chf end, 0)::numeric,
           coalesce((select sum(e.amount) from public.athlete_sponsorship_entries e where e.invoice_id = i.id and e.voided_at is null), 0)::numeric,
           coalesce(case when i.id is null then 0 else public.invoice_net_paid(i.id) end, 0)::numeric,
           coalesce(case when i.id is null or i.status::text in ('cancelled', 'void', 'draft', 'written_off', 'refunded') then 0
                         else greatest(public.invoice_amount_due(i.id) - public.invoice_net_paid(i.id), 0) end, 0)::numeric,
           a.installment_count, a.created_at, a.accepted_at, a.enrolled_at
      from public.program_applications a
      join public.programs p on p.id = a.program_id
      join public.athletes t on t.id = a.athlete_id
      join public.families f on f.id = a.family_id
      left join public.program_divisions d on d.id = a.division_id
      left join public.program_packages k on k.id = a.package_id
      left join public.invoices i on i.id = a.invoice_id
     where a.org_id = v_org
       and (p_program is null or a.program_id = p_program)
       and (p_season is null or p.season_year = p_season)
       and (p_division is null or a.division_id = p_division)
       and (p_package is null or a.package_id = p_package)
     order by p.name, d.sort nulls last, t.last_name, t.first_name;
end $$;

-- Grants on the RPCs ---------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.selection_issue_invoice(uuid)', 'public.selection_cancel_invoice(uuid, text)',
    'public.selection_enroll_internal(uuid)', 'public.selection_plan_internal(uuid, integer)',
    'public.selection_apply_internal(uuid, uuid, uuid, uuid, uuid, jsonb, text, uuid)',
    'public.selection_apply_public(jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
  foreach f in array array[
    'public.selection_apply(uuid, uuid, uuid, uuid, jsonb)', 'public.selection_set_status(uuid, text, text, uuid, text)',
    'public.selection_change_package(uuid, uuid)', 'public.selection_choose_plan(uuid, integer)',
    'public.selection_withdraw(uuid, text)', 'public.selection_review_list(uuid)',
    'public.selection_program_stats(uuid)', 'public.selection_report(uuid, integer, uuid, uuid)',
    'public.selection_suggest_division(uuid, date, date)', 'public.selection_coach_reviews(uuid, uuid)',
    'public.selection_head_coach(uuid)', 'public.selection_is_admin_of(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

-- 13) Feature key (Academy tier; add-on elsewhere) -------------------------------------------------------
insert into public.platform_features (key, category, is_core, default_tier, requires, sort_order, label)
values
  ('selection_programs', 'programs', false, 'academy', '{}'::text[], 195, 'Selection programmes: applications, packages & approvals')
on conflict (key) do nothing;

insert into public.feature_addon_prices (feature_key, currency, amount)
values ('selection_programs', 'CHF', 49.00), ('selection_programs', 'EUR', 49.00), ('selection_programs', 'USD', 54.00)
on conflict (feature_key, currency) do nothing;

update public.plans set features = features || jsonb_build_object('selection_programs', code in ('academy', 'federation'))
 where code in ('starter', 'club', 'academy', 'federation') and not (features ? 'selection_programs');
