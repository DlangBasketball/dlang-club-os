-- ============================================================================
-- Booking orders (phase C of the booking workflow)
--
--   1. Service pricing options (catalogue = source of truth): "1 Session" at
--      training_services.price_chf plus the service's credit_packages
--      (sessions + TOTAL price per athlete). Group services: group_rate_chf
--      and an explicit pricing_basis (only 'per_player_per_session' is
--      implemented: charge = rate x sessions booked by the player).
--      training_services.short_description (customer-facing, short).
--      service_pricing_save(): admin + finance edit the options.
--   2. booking_orders + booking_order_participants: one order = one service,
--      one pricing option, 1..N dates, 1..N players (group). Agreed prices are
--      snapshotted on the order, the participant and every booking, so a
--      catalogue change only affects new orders. Customer-facing description,
--      internal notes (separate), received_on (date the request came in).
--      training_bookings rows stay one per athlete per date, linked to the
--      order (order_id, order_participant_id).
--   3. Package option: the package is sold once (training_package_purchases
--      row linked to the order, invoiced once for the agreed total); 0..N
--      dates scheduled now, more later (booking_order_add_dates) consuming
--      the package (training_booking_entitlements, once per booking).
--   4. Dates: explicit list (one, several, or an expanded recurrence); every
--      date is checked (bk_evaluate) and the order is placed all-or-nothing.
--   5. Group: several players, one shared session per date (join), capacity
--      under the session lock, per-player payer and date subset.
--   6. Invoicing per payer (booking_order_create_invoices): one invoice per
--      payer, one line per athlete, one revenue category + issuing entity
--      (CATEGORY_MIXED otherwise). Order bookings share their payer invoice
--      (training_bookings.invoice_id), so payments, billing status, credit
--      notes and the portals keep working through the existing paths.
--   7. Partial changes: cancel / reschedule one booking, one player or one
--      date (booking_cancel / booking_reschedule per booking; credit note for
--      an issued line, a draft line is removed instead).
--
-- Additive and idempotent. One index is relaxed: "one invoice per workflow
-- booking" now applies to bookings without an order only.
-- Contract: docs/booking-workflow.md §13. Tests: tests/db/booking_orders.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Service pricing columns
-- ---------------------------------------------------------------------------
alter table public.training_services add column if not exists short_description text;
alter table public.training_services add column if not exists pricing_basis text not null default 'per_player_per_session';
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'training_services' and column_name = 'group_rate_chf') then
    alter table public.training_services add column group_rate_chf numeric(10,2);
    -- Existing group services priced "per person per session": the rate is that price (once, on creation).
    update public.training_services set group_rate_chf = price_chf where kind = 'group' and coalesce(price_chf, 0) > 0;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'training_services_pricing_chk') then
    alter table public.training_services add constraint training_services_pricing_chk check (
      (short_description is null or length(short_description) <= 280)
      and (group_rate_chf is null or group_rate_chf between 0 and 100000)
      and pricing_basis in ('per_player_per_session'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Orders and participants
-- ---------------------------------------------------------------------------
create table if not exists public.booking_orders (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  service_id            uuid not null references public.training_services(id) on delete restrict,
  kind                  text not null,
  option_kind           text not null,
  package_id            uuid references public.credit_packages(id) on delete set null,
  option_sessions       integer,
  list_total            numeric(12,2),
  agreed_total          numeric(12,2),
  list_rate             numeric(10,2),
  group_rate            numeric(10,2),
  pricing_basis         text,
  price_override_reason text,
  currency              text not null,
  billing_category      text not null,
  purchase_id           uuid references public.training_package_purchases(id) on delete set null,
  coach_id              uuid references public.coaches(id) on delete set null,
  venue_space_id        uuid references public.venue_spaces(id) on delete set null,
  description           text,
  internal_notes        text,
  received_on           date,
  status                text not null default 'active',
  cancelled_at          timestamptz,
  request_id            uuid,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint booking_orders_kind_chk check (kind in ('single', 'package', 'group')),
  constraint booking_orders_option_chk check (option_kind in ('single', 'package', 'existing_package', 'group')),
  constraint booking_orders_status_chk check (status in ('active', 'cancelled')),
  constraint booking_orders_money_chk check (
    (list_total is null or list_total >= 0) and (agreed_total is null or agreed_total >= 0)
    and (list_rate is null or list_rate >= 0) and (group_rate is null or group_rate >= 0)
    and (option_sessions is null or option_sessions between 1 and 1000)
    and currency ~ '^[A-Z]{3}$'
    and (pricing_basis is null or pricing_basis in ('per_player_per_session'))),
  constraint booking_orders_text_chk check (
    (description is null or length(description) <= 1000)
    and (internal_notes is null or length(internal_notes) <= 2000)
    and (price_override_reason is null or length(price_override_reason) <= 500))
);
create index if not exists idx_booking_orders_org on public.booking_orders (org_id, created_at desc);
create index if not exists idx_booking_orders_service on public.booking_orders (service_id);
create index if not exists idx_booking_orders_purchase on public.booking_orders (purchase_id) where purchase_id is not null;
create unique index if not exists booking_orders_request_uidx on public.booking_orders (org_id, request_id) where request_id is not null;

create table if not exists public.booking_order_participants (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  order_id      uuid not null references public.booking_orders(id) on delete cascade,
  athlete_id    uuid not null references public.athletes(id) on delete cascade,
  payer_id      uuid references public.billing_payers(id) on delete set null,
  rate          numeric(12,2) not null default 0,
  status        text not null default 'active',
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint booking_order_participants_chk check (rate >= 0 and status in ('active', 'cancelled')),
  unique (order_id, athlete_id)
);
create index if not exists idx_bop_org on public.booking_order_participants (org_id);
create index if not exists idx_bop_athlete on public.booking_order_participants (athlete_id);
create index if not exists idx_bop_payer on public.booking_order_participants (payer_id) where payer_id is not null;

alter table public.training_bookings add column if not exists order_id uuid references public.booking_orders(id) on delete set null;
alter table public.training_bookings add column if not exists order_participant_id uuid references public.booking_order_participants(id) on delete set null;
alter table public.training_bookings add column if not exists order_invoice_item_id uuid references public.invoice_items(id) on delete set null;
create index if not exists idx_bookings_order on public.training_bookings (order_id) where order_id is not null;
create index if not exists idx_bookings_order_participant on public.training_bookings (order_participant_id) where order_participant_id is not null;

-- Order bookings share their payer's invoice: "one invoice per workflow
-- booking" applies to bookings without an order only.
drop index if exists public.training_bookings_invoice_uidx;
create unique index if not exists training_bookings_invoice_single_uidx on public.training_bookings (invoice_id)
  where invoice_id is not null and created_via = 'workflow' and order_id is null;

alter table public.booking_orders enable row level security;
alter table public.booking_orders force row level security;
alter table public.booking_order_participants enable row level security;
alter table public.booking_order_participants force row level security;

-- Staff (admin + finance) read; every write goes through the order RPCs.
drop policy if exists booking_orders_select on public.booking_orders;
create policy booking_orders_select on public.booking_orders for select
  using (org_id = public.current_org_id() and public.is_finance());
drop policy if exists booking_orders_insert on public.booking_orders;
create policy booking_orders_insert on public.booking_orders for insert with check (false);
drop policy if exists booking_orders_update on public.booking_orders;
create policy booking_orders_update on public.booking_orders for update using (false) with check (false);
drop policy if exists booking_orders_delete on public.booking_orders;
create policy booking_orders_delete on public.booking_orders for delete using (false);

drop policy if exists bop_select on public.booking_order_participants;
create policy bop_select on public.booking_order_participants for select
  using (org_id = public.current_org_id() and public.is_finance());
drop policy if exists bop_insert on public.booking_order_participants;
create policy bop_insert on public.booking_order_participants for insert with check (false);
drop policy if exists bop_update on public.booking_order_participants;
create policy bop_update on public.booking_order_participants for update using (false) with check (false);
drop policy if exists bop_delete on public.booking_order_participants;
create policy bop_delete on public.booking_order_participants for delete using (false);

grant select on public.booking_orders, public.booking_order_participants to authenticated;
grant all on public.booking_orders, public.booking_order_participants to service_role;

drop trigger if exists trg_booking_orders_org on public.booking_orders;
create trigger trg_booking_orders_org before insert or update on public.booking_orders
  for each row execute function public.ca_same_org_guard('service_id:training_services', 'package_id:credit_packages',
    'purchase_id:training_package_purchases', 'coach_id:coaches', 'venue_space_id:venue_spaces');
drop trigger if exists trg_booking_orders_updated on public.booking_orders;
create trigger trg_booking_orders_updated before update on public.booking_orders
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_booking_orders on public.booking_orders;
create trigger trg_audit_booking_orders after insert or update or delete on public.booking_orders
  for each row execute function public.ca_audit_trigger('internal_notes', 'description');

drop trigger if exists trg_bop_org on public.booking_order_participants;
create trigger trg_bop_org before insert or update on public.booking_order_participants
  for each row execute function public.ca_same_org_guard('order_id:booking_orders', 'athlete_id:athletes', 'payer_id:billing_payers');
drop trigger if exists trg_bop_updated on public.booking_order_participants;
create trigger trg_bop_updated before update on public.booking_order_participants
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_bop on public.booking_order_participants;
create trigger trg_audit_bop after insert or update or delete on public.booking_order_participants
  for each row execute function public.audit_trigger();

drop trigger if exists trg_bookings_order_org on public.training_bookings;
create trigger trg_bookings_order_org before insert or update of order_id, order_participant_id on public.training_bookings
  for each row execute function public.ca_same_org_guard('order_id:booking_orders', 'order_participant_id:booking_order_participants');

-- ---------------------------------------------------------------------------
-- 3. Pricing helpers, catalogue, pricing editor
-- ---------------------------------------------------------------------------
-- Pricing options of a service: "1 Session" (price_chf; not for package-only
-- services) + the active packages (sessions, total per athlete). Group
-- services have no options: they use group_rate_chf.
create or replace function public.bko_options(p_svc public.training_services)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when p_svc.kind = 'group' then '[]'::jsonb else
    (case when p_svc.kind = 'package' then '[]'::jsonb
          else jsonb_build_array(jsonb_build_object(
                 'option_id', 'single', 'kind', 'single', 'sessions', 1, 'package_id', null, 'name', null, 'validity_days', null,
                 'total', round(coalesce(p_svc.price_chf, 0), public.currency_exponent(public.bk_currency(p_svc))))) end)
    || coalesce((select jsonb_agg(jsonb_build_object(
                          'option_id', p.id::text, 'kind', 'package', 'sessions', p.credits, 'package_id', p.id, 'name', p.name,
                          'validity_days', p.validity_days, 'total', p.price_chf) order by p.sort_order, p.credits, p.id)
                   from public.credit_packages p
                  where p.service_id = p_svc.id and p.org_id = p_svc.org_id and p.is_active), '[]'::jsonb)
  end;
$$;

-- What a service still needs before it can be ordered ("configure X in Services").
create or replace function public.bko_pricing_missing(p_svc public.training_services)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select array_remove(array[
    case when p_svc.kind = 'group' and p_svc.group_rate_chf is null then 'GROUP_RATE' end,
    case when p_svc.kind = 'package' and not exists (select 1 from public.credit_packages p
                                                     where p.service_id = p_svc.id and p.is_active) then 'PACKAGES' end], null);
$$;

-- Invoicing setup of a revenue category (category, issuing entity, number series).
create or replace function public.bko_setup_missing(p_org uuid, p_category text)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare v text[] := '{}';
begin
  if p_category is null or not public.is_billing_activity(p_category) or p_category = 'other' then
    return array['BILLING_CATEGORY_MISSING'];
  end if;
  if public.billing_entity_resolve(p_org, p_category) is null then v := v || 'BILLING_ENTITY_MISSING'::text; end if;
  if public.billing_series_prefix(p_org, p_category) is null then v := v || 'NUMBER_SERIES_MISSING'::text; end if;
  return v;
end $$;

-- Deterministic sub-request id (one per booking of an order operation): the
-- order's request id replays the whole operation; the derived ids keep the
-- per-booking RPCs (booking_cancel, booking_reschedule) idempotent too.
create or replace function public.bko_sub_id(p_request uuid, p_a text, p_b text)
returns uuid
language sql
immutable
set search_path = public
as $$
  select md5(p_request::text || ':' || coalesce(p_a, '') || ':' || coalesce(p_b, ''))::uuid;
$$;

-- Catalogue: + short description, pricing options with totals, group rate, pricing basis.
create or replace function public.training_service_catalog(p_include_inactive boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'slug', s.slug, 'name', s.name, 'kind', s.kind, 'session_type', s.session_type,
             'is_active', s.is_active, 'billing_category', s.billing_category,
             'price', s.price_chf, 'currency', public.bk_currency(s), 'duration_min', s.duration_min,
             'max_participants', s.max_participants, 'min_participants', s.min_participants,
             'venue_id', s.venue_id, 'venue_name', (select v.name from public.venues v where v.id = s.venue_id),
             'default_venue_space_id', s.default_venue_space_id,
             'default_venue_space_name', (select vs.name from public.venue_spaces vs where vs.id = s.default_venue_space_id),
             'location_text', s.location_text, 'credits_required', s.credits_required,
             'bookable_by_families', s.bookable_by_families,
             'short_description', s.short_description, 'group_rate', s.group_rate_chf, 'pricing_basis', s.pricing_basis,
             'pricing_options', public.bko_options(s), 'pricing_missing', to_jsonb(public.bko_pricing_missing(s)),
             'coaches', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'display_name', c.display_name) order by c.display_name)
                                    from public.coaches c
                                   where c.org_id = s.org_id and c.is_active and public.bk_coach_eligible(s.id, c.id)), '[]'::jsonb),
             'packages', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'sessions', p.credits,
                                                                       'total', p.price_chf, 'is_active', p.is_active,
                                                                       'validity_days', p.validity_days)
                                                    order by p.sort_order, p.credits)
                                     from public.credit_packages p where p.service_id = s.id), '[]'::jsonb),
             'setup_missing', to_jsonb(public.bk_setup_missing(s)),
             'number_prefix', public.billing_series_prefix(s.org_id, s.billing_category))
           order by s.sort_order, s.name)
      from public.training_services s
     where s.org_id = v_org and (p_include_inactive or s.is_active)), '[]'::jsonb);
end $$;

-- Pricing editor (admin + finance): single-session price, short description,
-- group rate + basis, packages (sessions, total, validity, active). A
-- removed package that was ever sold or ordered is deactivated, not deleted.
create or replace function public.service_pricing_save(p_service uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  s       public.training_services;
  v_exp   int;
  v_price numeric;
  v_rate  numeric;
  v_desc  text;
  v_basis text;
  p       jsonb;
  v_keep  uuid[] := '{}';
  v_id    uuid;
  v_n     int;
  v_cnt   int;
  v_tot   numeric;
  v_val   int;
  v_before jsonb;
  x       jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into s from public.training_services where id = p_service and org_id = v_org for update;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
  v_exp := public.currency_exponent(public.bk_currency(s));
  v_before := jsonb_build_object('price', s.price_chf, 'group_rate', s.group_rate_chf, 'pricing_basis', s.pricing_basis,
                                 'short_description', s.short_description, 'options', public.bko_options(s));

  v_price := case when x ? 'price' and nullif(x->>'price', '') is not null then round((x->>'price')::numeric, v_exp) else s.price_chf end;
  if v_price is null or v_price < 0 or v_price > 100000 then raise exception 'INVALID_PRICE' using errcode = 'P0001'; end if;
  v_rate := case when x ? 'group_rate' then round(nullif(x->>'group_rate', '')::numeric, v_exp) else s.group_rate_chf end;
  if v_rate is not null and (v_rate < 0 or v_rate > 100000) then raise exception 'INVALID_PRICE' using errcode = 'P0001'; end if;
  v_basis := coalesce(nullif(x->>'pricing_basis', ''), s.pricing_basis, 'per_player_per_session');
  if v_basis <> 'per_player_per_session' then raise exception 'INVALID_PRICING_BASIS' using errcode = 'P0001'; end if;
  v_desc := case when x ? 'short_description' then nullif(btrim(coalesce(x->>'short_description', '')), '') else s.short_description end;
  if length(coalesce(v_desc, '')) > 280 then raise exception 'DESCRIPTION_TOO_LONG' using errcode = 'P0001'; end if;

  update public.training_services
     set price_chf = v_price, group_rate_chf = v_rate, pricing_basis = v_basis, short_description = v_desc
   where id = s.id;

  if jsonb_typeof(x->'packages') = 'array' then
    if jsonb_array_length(x->'packages') > 20 then raise exception 'TOO_MANY_PACKAGES' using errcode = 'P0001'; end if;
    if (select count(*) <> count(distinct (e->>'sessions'))
          from jsonb_array_elements(x->'packages') e where coalesce((e->>'is_active')::boolean, true)) then
      raise exception 'DUPLICATE_PACKAGE' using errcode = 'P0001';
    end if;
    v_n := 0;
    for p in select e from jsonb_array_elements(x->'packages') e loop
      v_n := v_n + 1;
      begin
        v_tot := round((p->>'total')::numeric, v_exp);
        v_val := nullif(p->>'validity_days', '')::int;
        v_cnt := (p->>'sessions')::int;
      exception when others then
        raise exception 'INVALID_PACKAGE' using errcode = 'P0001';
      end;
      if v_cnt is null or v_cnt not between 1 and 1000 or v_tot is null or v_tot < 0 or v_tot > 1000000
         or (v_val is not null and v_val not between 1 and 3650) then
        raise exception 'INVALID_PACKAGE' using errcode = 'P0001';
      end if;
      v_id := nullif(p->>'id', '')::uuid;
      if v_id is not null and exists (select 1 from public.credit_packages where id = v_id and service_id = s.id and org_id = v_org) then
        update public.credit_packages
           set credits = (p->>'sessions')::int, price_chf = v_tot, validity_days = v_val,
               is_active = coalesce((p->>'is_active')::boolean, true), sort_order = v_n,
               name = coalesce(nullif(btrim(coalesce(p->>'name', '')), ''), name)
         where id = v_id;
      else
        insert into public.credit_packages (org_id, service_id, name, credit_category, credits, price_chf, validity_days, is_active, sort_order)
        values (v_org, s.id, left(coalesce(nullif(btrim(coalesce(p->>'name', '')), ''), (p->>'sessions')), 120), s.credit_category,
                (p->>'sessions')::int, v_tot, v_val, coalesce((p->>'is_active')::boolean, true), v_n)
        returning id into v_id;
      end if;
      v_keep := v_keep || v_id;
    end loop;
    -- Removed rows: deleted when never used, else deactivated (history keeps its snapshot).
    update public.credit_packages cp set is_active = false
     where cp.service_id = s.id and cp.org_id = v_org and not (cp.id = any(v_keep))
       and (exists (select 1 from public.training_package_purchases tp where tp.package_id = cp.id)
            or exists (select 1 from public.booking_orders o where o.package_id = cp.id));
    delete from public.credit_packages cp
     where cp.service_id = s.id and cp.org_id = v_org and not (cp.id = any(v_keep))
       and not exists (select 1 from public.training_package_purchases tp where tp.package_id = cp.id)
       and not exists (select 1 from public.booking_orders o where o.package_id = cp.id);
  end if;

  select * into s from public.training_services where id = s.id;
  perform public.money_audit(v_org, 'SERVICE_PRICING_SAVED', 'training_services', s.id, v_before,
    jsonb_build_object('price', s.price_chf, 'group_rate', s.group_rate_chf, 'pricing_basis', s.pricing_basis,
                       'short_description', s.short_description, 'options', public.bko_options(s)));
  return jsonb_build_object('ok', true, 'service_id', s.id, 'price', s.price_chf, 'group_rate', s.group_rate_chf,
                            'pricing_basis', s.pricing_basis, 'short_description', s.short_description,
                            'currency', public.bk_currency(s), 'pricing_options', public.bko_options(s),
                            'pricing_missing', to_jsonb(public.bko_pricing_missing(s)));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Order plan (quote): pricing, participants, every date checked.
--    x = {service_id, option: single | package | existing_package | group,
--         package_id?, purchase_id?, agreed_total?, agreed_rate?, price_reason?,
--         coach_id?, venue_space_id?, dates: [iso], participants: [{athlete_id,
--         payer_id?, dates?: [iso]}], description?, internal_notes?,
--         received_on?, override_availability?, override_reason?, notify?,
--         fixed_rate? (internal: the order's own rate, no override check)}
--    Writes nothing. Charges: single / package = the agreed total once;
--    existing_package = 0; group = rate x the player's dates.
-- ---------------------------------------------------------------------------
create or replace function public.bko_plan(p_org uuid, x jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_svc    public.training_services;
  v_err    text[] := '{}';
  v_opt    text := coalesce(nullif(x->>'option', ''), '');
  v_kind   text;
  v_cur    text;
  v_exp    int;
  v_pkg    public.credit_packages;
  v_lot    public.training_package_purchases;
  v_sess   int;
  v_list   numeric;
  v_agreed numeric;
  v_lrate  numeric;
  v_rate   numeric;
  v_over   boolean := false;
  v_ov     boolean;
  v_coach  uuid := nullif(x->>'coach_id', '')::uuid;
  v_space  uuid := nullif(x->>'venue_space_id', '')::uuid;
  v_dates  timestamptz[] := '{}';
  v_raw    int;
  v_parts  jsonb := '[]'::jsonb;
  p        jsonb;
  a        public.athletes;
  v_pdates timestamptz[];
  v_seen   uuid[] := '{}';
  d        timestamptz;
  i        int;
  v_dout   jsonb := '[]'::jsonb;
  v_ev     jsonb;
  v_slot   jsonb;
  v_derr   text[];
  v_dwarn  jsonb;
  v_aerr   jsonb;
  v_on     int;
  v_cap    int;
  v_exist  int;
  v_dur    interval;
  v_all_ok boolean := true;
  v_total  numeric := 0;
  v_charge numeric;
  v_payer  jsonb;
  v_pout   jsonb := '[]'::jsonb;
  v_missing text[] := '{}';
  v_pmiss  text[];
  e        text;
  v_ent    uuid;
begin
  select * into v_svc from public.training_services where id = nullif(x->>'service_id', '')::uuid and org_id = p_org;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not v_svc.is_active then v_err := v_err || 'SERVICE_INACTIVE'::text; end if;
  v_cur := public.bk_currency(v_svc);
  v_exp := public.currency_exponent(v_cur);
  v_dur := make_interval(mins => v_svc.duration_min);
  v_pmiss := public.bko_pricing_missing(v_svc);

  if v_opt not in ('single', 'package', 'existing_package', 'group') then
    v_err := v_err || 'OPTION_REQUIRED'::text;
    v_opt := case when v_svc.kind = 'group' then 'group' else 'single' end;
  end if;
  if (v_svc.kind = 'group') <> (v_opt = 'group') or (v_svc.kind = 'package' and v_opt = 'single') then
    v_err := v_err || 'OPTION_NOT_OFFERED'::text;
  end if;
  v_kind := case v_opt when 'group' then 'group' when 'single' then 'single' else 'package' end;

  -- Pricing option and agreed price (snapshot).
  if v_opt = 'single' then
    v_sess := 1;
    v_list := round(coalesce(v_svc.price_chf, 0), v_exp);
  elsif v_opt = 'package' then
    select * into v_pkg from public.credit_packages
     where id = nullif(x->>'package_id', '')::uuid and service_id = v_svc.id and org_id = p_org and is_active;
    if not found then v_err := v_err || 'PACKAGE_NOT_FOUND'::text; v_sess := 0; v_list := 0;
    else v_sess := v_pkg.credits; v_list := round(v_pkg.price_chf, v_exp); end if;
  elsif v_opt = 'existing_package' then
    select * into v_lot from public.training_package_purchases tp
     where tp.id = nullif(x->>'purchase_id', '')::uuid and tp.org_id = p_org and tp.service_id = v_svc.id
       and tp.status = 'active' and (tp.expires_at is null or tp.expires_at > now());
    if not found then v_err := v_err || 'PACKAGE_NOT_AVAILABLE'::text; v_sess := 0;
    else v_sess := v_lot.sessions - v_lot.sessions_used; end if;
    v_list := 0;
  else
    v_lrate := v_svc.group_rate_chf;
  end if;

  if v_opt = 'group' then
    v_rate := coalesce(round(nullif(x->>'agreed_rate', '')::numeric, v_exp), v_lrate);
    if v_rate is null then
      v_err := v_err || 'PRICING_MISSING'::text;
    elsif v_rate < 0 or v_rate > 100000 then
      v_err := v_err || 'INVALID_PRICE'::text;
    end if;
    v_over := not coalesce((x->>'fixed_rate')::boolean, false) and v_rate is distinct from v_lrate and v_rate is not null;
  elsif v_opt in ('single', 'package') then
    v_agreed := coalesce(round(nullif(x->>'agreed_total', '')::numeric, v_exp), v_list);
    if v_agreed < 0 or v_agreed > 1000000 then v_err := v_err || 'INVALID_PRICE'::text; end if;
    v_over := v_agreed is distinct from v_list;
  else
    v_agreed := 0;
  end if;
  if v_over and nullif(btrim(coalesce(x->>'price_reason', '')), '') is null then
    v_err := v_err || 'PRICE_OVERRIDE_REASON_REQUIRED'::text;
  end if;
  if length(coalesce(x->>'price_reason', '')) > 500 then v_err := v_err || 'REASON_TOO_LONG'::text; end if;
  if 'GROUP_RATE' = any(v_pmiss) and v_opt = 'group' and nullif(x->>'agreed_rate', '') is null and not ('PRICING_MISSING' = any(v_err)) then
    v_err := v_err || 'PRICING_MISSING'::text;
  end if;
  if 'PACKAGES' = any(v_pmiss) and v_opt = 'package' and not ('PRICING_MISSING' = any(v_err)) then
    v_err := v_err || 'PRICING_MISSING'::text;
  end if;

  -- Overrides and texts.
  if coalesce((x->>'override_availability')::boolean, false) and not public.is_admin() then
    v_err := v_err || 'OVERRIDE_NOT_ALLOWED'::text;
  end if;
  v_ov := public.is_admin() and coalesce((x->>'override_availability')::boolean, false);
  if v_ov and nullif(btrim(coalesce(x->>'override_reason', '')), '') is null then v_err := v_err || 'OVERRIDE_REASON_REQUIRED'::text; end if;
  if length(coalesce(x->>'override_reason', '')) > 500 then v_err := v_err || 'REASON_TOO_LONG'::text; end if;
  if length(coalesce(x->>'description', '')) > 1000 then v_err := v_err || 'DESCRIPTION_TOO_LONG'::text; end if;
  if length(coalesce(x->>'internal_notes', '')) > 2000 then v_err := v_err || 'NOTE_TOO_LONG'::text; end if;
  if nullif(x->>'received_on', '') is not null then
    begin
      perform (x->>'received_on')::date;
    exception when others then v_err := v_err || 'INVALID_DATE'::text;
    end;
  end if;

  -- Dates (explicit list; a recurrence is expanded by the caller).
  if jsonb_typeof(x->'dates') = 'array' then
    begin
      select coalesce(array_agg(distinct (e2)::timestamptz order by (e2)::timestamptz), '{}'), count(*)
        into v_dates, v_raw
        from jsonb_array_elements_text(x->'dates') e2;
    exception when others then
      v_err := v_err || 'INVALID_TIME'::text; v_dates := '{}'; v_raw := 0;
    end;
    if v_raw <> cardinality(v_dates) then v_err := v_err || 'DUPLICATE_DATE'::text; end if;
  end if;
  if cardinality(v_dates) > 60 then v_err := v_err || 'TOO_MANY_DATES'::text; end if;
  if v_opt = 'single' and cardinality(v_dates) <> 1 then v_err := v_err || 'SINGLE_ONE_DATE'::text; end if;
  if v_opt = 'group' and cardinality(v_dates) = 0 then v_err := v_err || 'DATES_REQUIRED'::text; end if;
  if v_opt in ('package', 'existing_package') and cardinality(v_dates) > coalesce(v_sess, 0) then
    v_err := v_err || 'PACKAGE_TOO_MANY_DATES'::text;
  end if;
  if cardinality(v_dates) > 0 and v_coach is null then v_err := v_err || 'COACH_REQUIRED'::text; end if;

  -- Participants.
  if jsonb_typeof(x->'participants') <> 'array' or jsonb_array_length(x->'participants') = 0 then
    v_err := v_err || 'ATHLETE_REQUIRED'::text;
  else
    if jsonb_array_length(x->'participants') > 30 then v_err := v_err || 'TOO_MANY_PARTICIPANTS'::text; end if;
    if v_kind <> 'group' and jsonb_array_length(x->'participants') > 1 then v_err := v_err || 'ONE_ATHLETE_ONLY'::text; end if;
    for p in select e3 from jsonb_array_elements(x->'participants') e3 loop
      select * into a from public.athletes where id = nullif(p->>'athlete_id', '')::uuid and org_id = p_org;
      if not found then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
      if a.archived_at is not null then v_err := v_err || 'ATHLETE_ARCHIVED'::text; end if;
      if a.id = any(v_seen) then v_err := v_err || 'DUPLICATE_ATHLETE'::text; continue; end if;
      v_seen := v_seen || a.id;
      if nullif(p->>'payer_id', '') is not null
         and not exists (select 1 from public.billing_payers bp where bp.id = (p->>'payer_id')::uuid and bp.org_id = p_org and bp.is_active) then
        v_err := v_err || 'PAYER_NOT_FOUND'::text;
      end if;
      if v_opt = 'existing_package' and v_lot.id is not null and v_lot.athlete_id <> a.id then
        v_err := v_err || 'PACKAGE_NOT_AVAILABLE'::text;
      end if;
      v_pdates := v_dates;
      if jsonb_typeof(p->'dates') = 'array' then
        begin
          select coalesce(array_agg(distinct (e4)::timestamptz order by (e4)::timestamptz), '{}') into v_pdates
            from jsonb_array_elements_text(p->'dates') e4;
        exception when others then v_pdates := '{}'; v_err := v_err || 'INVALID_TIME'::text;
        end;
        if exists (select 1 from unnest(v_pdates) pd where not (pd = any(v_dates))) then
          v_err := v_err || 'PARTICIPANT_DATE_UNKNOWN'::text;
          v_pdates := array(select pd from unnest(v_pdates) pd where pd = any(v_dates));
        end if;
      end if;
      if v_kind = 'group' and cardinality(v_pdates) = 0 and cardinality(v_dates) > 0 then
        v_err := v_err || 'PARTICIPANT_NO_DATES'::text;
      end if;
      v_charge := case v_opt when 'group' then coalesce(v_rate, 0) * cardinality(v_pdates)
                             when 'existing_package' then 0 else coalesce(v_agreed, 0) end;
      v_payer := public.bk_payer_snapshot(p_org, nullif(p->>'payer_id', '')::uuid, a.family_id);
      v_total := v_total + v_charge;
      v_parts := v_parts || jsonb_build_object(
        'athlete_id', a.id, 'first_name', a.first_name, 'last_name', a.last_name, 'family_id', a.family_id,
        'payer_id', nullif(p->>'payer_id', ''), 'payer', v_payer,
        'payer_key', coalesce('payer:' || nullif(p->>'payer_id', ''), 'family:' || a.family_id::text),
        'dates', to_jsonb(v_pdates), 'sessions', cardinality(v_pdates),
        'rate', case v_opt when 'group' then v_rate when 'existing_package' then 0 else v_agreed end,
        'charge', v_charge);
    end loop;
  end if;

  -- Every date: availability, coach / space conflicts, capacity for the
  -- players of this order, athlete conflicts, overlaps inside the order.
  i := 0;
  foreach d in array v_dates loop
    i := i + 1;
    v_derr := '{}'; v_dwarn := '[]'::jsonb; v_aerr := '[]'::jsonb; v_on := 0; v_slot := null;
    for p in select e5 from jsonb_array_elements(v_parts) e5 where (e5->'dates') ? (to_jsonb(d) #>> '{}') loop
      v_on := v_on + 1;
      v_ev := public.bk_evaluate(p_org, (p->>'athlete_id')::uuid, v_svc, v_coach, d, null, v_space, v_ov, null);
      if v_slot is null then
        v_slot := v_ev;
        v_dwarn := coalesce((select jsonb_agg(w) from jsonb_array_elements(v_ev->'warnings') w where w->>'code' <> 'ATHLETE_OVERLAP'), '[]'::jsonb);
      end if;
      for e in select jsonb_array_elements_text(v_ev->'errors') loop
        if e in ('ALREADY_BOOKED', 'ATHLETE_OVERLAP') then
          v_aerr := v_aerr || jsonb_build_object('athlete_id', p->>'athlete_id', 'code', e);
        elsif not (e = any(v_derr)) then
          v_derr := v_derr || e;
        end if;
      end loop;
      v_dwarn := v_dwarn || coalesce((select jsonb_agg(w || jsonb_build_object('athlete_id', p->>'athlete_id'))
                                        from jsonb_array_elements(v_ev->'warnings') w where w->>'code' = 'ATHLETE_OVERLAP'), '[]'::jsonb);
    end loop;
    if v_slot is null then
      -- Nobody on this date (every player left it out): checked for the slot only.
      v_slot := public.bk_evaluate(p_org, null, v_svc, v_coach, d, null, v_space, v_ov, null);
      v_derr := array(select jsonb_array_elements_text(v_slot->'errors'));
      v_dwarn := coalesce(v_slot->'warnings', '[]'::jsonb);
      if cardinality(v_dates) > 0 and jsonb_array_length(v_parts) > 0 then v_derr := v_derr || 'DATE_WITHOUT_PLAYERS'::text; end if;
    end if;
    v_cap := nullif(v_slot->>'capacity', '')::int;
    v_exist := coalesce(nullif(v_slot->>'participants', '')::int, 0);
    if v_cap is not null and v_exist + v_on > v_cap and not ('SESSION_FULL' = any(v_derr)) then
      v_derr := v_derr || 'SESSION_FULL'::text;
    end if;
    if exists (select 1 from unnest(v_dates) o where o <> d and tstzrange(o, o + v_dur, '[)') && tstzrange(d, d + v_dur, '[)')) then
      v_derr := v_derr || 'ORDER_DATES_OVERLAP'::text;
    end if;
    if cardinality(v_derr) > 0 or jsonb_array_length(v_aerr) > 0 then v_all_ok := false; end if;
    v_dout := v_dout || jsonb_build_object(
      'starts_at', d, 'ends_at', d + v_dur, 'ok', cardinality(v_derr) = 0 and jsonb_array_length(v_aerr) = 0,
      'errors', to_jsonb(v_derr), 'athlete_errors', v_aerr, 'warnings', v_dwarn,
      'session_id', v_slot->'session_id', 'coach_id', v_slot->'coach_id', 'venue_space_id', v_slot->'venue_space_id',
      'capacity', v_cap, 'participants', v_exist, 'adding', v_on,
      'places_left', case when v_cap is null then null else greatest(0, v_cap - v_exist - v_on) end,
      'within_availability', coalesce((v_slot->>'within_availability')::boolean, false),
      'creates', case when coalesce((v_slot->>'needs_confirmation')::boolean, false) then 'requested' else 'booked' end);
  end loop;

  if v_total > 0 then v_missing := public.bko_setup_missing(p_org, v_svc.billing_category); end if;
  v_ent := public.billing_entity_resolve(p_org, v_svc.billing_category);

  return jsonb_build_object(
    'ok', cardinality(v_err) = 0 and v_all_ok,
    'errors', to_jsonb(v_err),
    'dates_ok', v_all_ok,
    'dates', v_dout,
    'participants', v_parts,
    'option', jsonb_build_object(
      'option', v_opt, 'kind', v_kind, 'package_id', v_pkg.id, 'package_name', v_pkg.name, 'validity_days', v_pkg.validity_days,
      'purchase_id', v_lot.id, 'sessions', v_sess,
      'package_remaining', case when v_lot.id is not null then v_lot.sessions - v_lot.sessions_used end,
      'list_total', case when v_opt in ('single', 'package') then v_list end,
      'agreed_total', case when v_opt in ('single', 'package') then v_agreed end,
      'list_rate', v_lrate, 'agreed_rate', v_rate, 'pricing_basis', case when v_opt = 'group' then v_svc.pricing_basis end,
      'price_override', v_over, 'currency', v_cur),
    'totals', jsonb_build_object(
      'charge', v_total, 'currency', v_cur,
      'sessions', coalesce((select sum((e6->>'sessions')::int) from jsonb_array_elements(v_parts) e6), 0),
      'payers', coalesce((select jsonb_agg(jsonb_build_object('payer_key', k, 'name', nm, 'charge', amt, 'athletes', n) order by nm)
                            from (select e7->>'payer_key' k, min(e7->'payer'->>'name') nm, sum((e7->>'charge')::numeric) amt, count(*) n
                                    from jsonb_array_elements(v_parts) e7 group by e7->>'payer_key') q), '[]'::jsonb)),
    'service', jsonb_build_object('id', v_svc.id, 'name', v_svc.name, 'kind', v_svc.kind, 'duration_min', v_svc.duration_min,
                                  'billing_category', v_svc.billing_category, 'max_participants', v_svc.max_participants,
                                  'short_description', v_svc.short_description),
    'override', v_ov,
    'setup_missing', to_jsonb(v_missing),
    'pricing_missing', to_jsonb(v_pmiss),
    'billing_entity', (select jsonb_build_object('id', be.id, 'name', be.name) from public.billing_entities be where be.id = v_ent),
    'number_prefix', public.billing_series_prefix(p_org, v_svc.billing_category));
end $$;

create or replace function public.booking_order_quote(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return public.bko_plan(public.current_org_id(), coalesce(p_payload, '{}'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Placing the bookings of a plan (internal; callers locked the coach and
--    checked the plan). One booking per player per date, joined to the
--    shared session of the date; a refusal names the date (DETAIL) and the
--    whole order rolls back.
-- ---------------------------------------------------------------------------
create or replace function public.bko_place_all(
  p_org uuid, p_order public.booking_orders, p_plan jsonb, x jsonb, p_request uuid, p_ov boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_svc  public.training_services;
  d      jsonb;
  p      jsonb;
  a      public.athletes;
  v_pid  uuid;
  v_ev   jsonb;
  v_code text;
  v_bill jsonb;
  v_xp   jsonb;
  v_res  jsonb;
  v_out  jsonb := '[]'::jsonb;
  v_opt  text := p_plan->'option'->>'option';
  v_price numeric;
  v_list numeric;
  v_status text;
begin
  select * into v_svc from public.training_services where id = p_order.service_id;
  for d in select e from jsonb_array_elements(p_plan->'dates') e order by (e->>'starts_at')::timestamptz loop
    for p in select e from jsonb_array_elements(p_plan->'participants') e where (e->'dates') ? (d->>'starts_at') loop
      select * into a from public.athletes where id = (p->>'athlete_id')::uuid;
      select id into v_pid from public.booking_order_participants where order_id = p_order.id and athlete_id = a.id;
      v_ev := public.bk_evaluate(p_org, a.id, v_svc, p_order.coach_id, (d->>'starts_at')::timestamptz, null,
                                 p_order.venue_space_id, p_ov, null);
      v_code := public.bk_first_error(v_ev);
      if v_code is not null then
        raise exception '%', v_code using errcode = 'P0001',
          detail = jsonb_build_object('starts_at', d->>'starts_at', 'athlete_id', a.id)::text;
      end if;
      if v_opt in ('package', 'existing_package') then
        v_bill := jsonb_build_object('billing_mode', 'package', 'price', 0, 'list_price', 0, 'currency', p_order.currency,
                                     'purchase_id', p_order.purchase_id, 'price_override', false, 'discount_total', 0);
      else
        v_price := (p->>'rate')::numeric;
        v_list := case when v_opt = 'group' then coalesce(p_order.list_rate, v_price) else coalesce(p_order.list_total, v_price) end;
        v_bill := jsonb_build_object('billing_mode', case when v_price > 0 then 'invoice' else 'free' end, 'price', v_price,
                                     'list_price', v_list, 'currency', p_order.currency, 'purchase_id', null,
                                     'price_override', v_price is distinct from v_list and p_order.price_override_reason is not null,
                                     'discount_total', 0);
      end if;
      v_status := case when coalesce((v_ev->>'needs_confirmation')::boolean, false) then 'requested' else 'booked' end;
      v_xp := jsonb_build_object('payer_id', p->>'payer_id', 'notes', null, 'price_reason', p_order.price_override_reason,
                                 'override_reason', x->>'override_reason');
      begin
        v_res := public.bk_place(p_org, a, v_svc, v_xp, v_ev, v_bill, v_status, 'staff',
                                 public.bko_sub_id(p_request, a.id::text, d->>'starts_at'), p_ov);
      exception when others then
        raise exception '%', sqlerrm using errcode = 'P0001',
          detail = jsonb_build_object('starts_at', d->>'starts_at', 'athlete_id', a.id)::text;
      end;
      update public.training_bookings set order_id = p_order.id, order_participant_id = v_pid
       where id = (v_res->>'booking_id')::uuid;
      if coalesce((x->>'notify')::boolean, true) then
        perform public.bk_enqueue_notifications((v_res->>'booking_id')::uuid,
                                                case when v_status = 'requested' then 'requested' else 'confirmed' end);
      end if;
      v_out := v_out || jsonb_build_object('booking_id', v_res->'booking_id', 'session_id', v_res->'session_id',
                                           'athlete_id', a.id, 'starts_at', v_res->'starts_at', 'status', v_status);
    end loop;
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Confirm an order (staff). All-or-nothing; idempotent with request_id.
--    Per-date refusals are returned {ok:false, code:'DATES_UNAVAILABLE',
--    dates} (nothing stored, the same request id can be retried).
-- ---------------------------------------------------------------------------
create or replace function public.booking_order_confirm(p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x       jsonb := coalesce(p_payload, '{}'::jsonb);
  v_org   uuid := public.current_org_id();
  v_rep   jsonb;
  v_oid   uuid;
  v_plan  jsonb;
  v_svc   public.training_services;
  o       public.booking_orders;
  p       jsonb;
  v_lot   public.training_package_purchases;
  v_ov    boolean;
  v_books jsonb;
  v_res   jsonb;
  v_reason text := nullif(btrim(coalesce(x->>'price_reason', '')), '');
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'order_confirm');
  if v_rep is not null then return v_rep; end if;
  select id into v_oid from public.booking_orders where org_id = v_org and request_id = p_request_id;
  if v_oid is not null then return jsonb_build_object('ok', true, 'order_id', v_oid, 'replayed', true); end if;

  -- Serialise with other bookings of the coach (and the package being used).
  if nullif(x->>'coach_id', '') is not null then
    perform 1 from public.coaches where id = (x->>'coach_id')::uuid and org_id = v_org for update;
  end if;
  if x->>'option' = 'existing_package' and nullif(x->>'purchase_id', '') is not null then
    perform 1 from public.training_package_purchases where id = (x->>'purchase_id')::uuid and org_id = v_org for update;
  end if;

  v_plan := public.bko_plan(v_org, x);
  if jsonb_array_length(v_plan->'errors') > 0 then
    raise exception '%', v_plan->'errors'->>0 using errcode = 'P0001';
  end if;
  if not (v_plan->>'dates_ok')::boolean then
    return jsonb_build_object('ok', false, 'code', 'DATES_UNAVAILABLE', 'dates', v_plan->'dates', 'replayed', false);
  end if;
  select * into v_svc from public.training_services where id = (v_plan->'service'->>'id')::uuid;
  v_ov := (v_plan->>'override')::boolean;

  perform set_config('app.bk_internal', 'on', true);
  insert into public.booking_orders (org_id, service_id, kind, option_kind, package_id, option_sessions, list_total, agreed_total,
                                     list_rate, group_rate, pricing_basis, price_override_reason, currency, billing_category,
                                     purchase_id, coach_id, venue_space_id, description, internal_notes, received_on, request_id, created_by)
  values (v_org, v_svc.id, v_plan->'option'->>'kind', v_plan->'option'->>'option',
          nullif(v_plan->'option'->>'package_id', '')::uuid,
          case when v_plan->'option'->>'option' in ('single', 'package') then nullif(v_plan->'option'->>'sessions', '')::int end,
          nullif(v_plan->'option'->>'list_total', '')::numeric, nullif(v_plan->'option'->>'agreed_total', '')::numeric,
          nullif(v_plan->'option'->>'list_rate', '')::numeric, nullif(v_plan->'option'->>'agreed_rate', '')::numeric,
          nullif(v_plan->'option'->>'pricing_basis', ''),
          case when (v_plan->'option'->>'price_override')::boolean then v_reason end,
          v_plan->'option'->>'currency', v_svc.billing_category,
          case when x->>'option' = 'existing_package' then nullif(v_plan->'option'->>'purchase_id', '')::uuid end,
          nullif(x->>'coach_id', '')::uuid,
          coalesce(nullif(x->>'venue_space_id', '')::uuid, v_svc.default_venue_space_id),
          nullif(btrim(coalesce(x->>'description', '')), ''), nullif(btrim(coalesce(x->>'internal_notes', '')), ''),
          nullif(x->>'received_on', '')::date, p_request_id, auth.uid())
  returning * into o;

  for p in select e from jsonb_array_elements(v_plan->'participants') e loop
    insert into public.booking_order_participants (org_id, order_id, athlete_id, payer_id, rate)
    values (v_org, o.id, (p->>'athlete_id')::uuid, nullif(p->>'payer_id', '')::uuid, coalesce((p->>'rate')::numeric, 0));
  end loop;

  -- Package option: the package is sold once, at the agreed total; usable at once.
  if o.option_kind = 'package' then
    p := v_plan->'participants'->0;
    insert into public.training_package_purchases
      (org_id, athlete_id, family_id, service_id, package_id, sessions, list_price, discount_total, amount, currency,
       payment_mode, status, validity_days, granted_at, expires_at, created_by)
    values (v_org, (p->>'athlete_id')::uuid, (p->>'family_id')::uuid, v_svc.id, o.package_id, o.option_sessions,
            greatest(coalesce(o.list_total, 0), o.agreed_total), greatest(0, coalesce(o.list_total, 0) - o.agreed_total),
            o.agreed_total, o.currency, 'invoice', 'active',
            nullif(v_plan->'option'->>'validity_days', '')::int, now(),
            case when nullif(v_plan->'option'->>'validity_days', '') is not null
                 then now() + make_interval(days => (v_plan->'option'->>'validity_days')::int) end, auth.uid())
    returning * into v_lot;
    update public.booking_orders set purchase_id = v_lot.id where id = o.id returning * into o;
    perform public.money_audit(v_org, 'BOOKING_ORDER_PACKAGE_SOLD', 'training_package_purchases', v_lot.id, null,
      jsonb_build_object('order_id', o.id, 'sessions', v_lot.sessions, 'list_total', o.list_total, 'agreed_total', o.agreed_total,
                         'currency', o.currency));
  end if;

  v_books := public.bko_place_all(v_org, o, v_plan, x, p_request_id, v_ov);

  if (v_plan->'option'->>'price_override')::boolean then
    perform public.money_audit(v_org, 'BOOKING_ORDER_PRICE_OVERRIDE', 'booking_orders', o.id,
      jsonb_build_object('list_total', o.list_total, 'list_rate', o.list_rate),
      jsonb_build_object('agreed_total', o.agreed_total, 'group_rate', o.group_rate, 'reason', o.price_override_reason));
  end if;
  if v_ov then
    perform public.money_audit(v_org, 'BOOKING_ORDER_AVAILABILITY_OVERRIDE', 'booking_orders', o.id, null,
      jsonb_build_object('reason', x->>'override_reason'));
  end if;
  perform set_config('app.bk_internal', '', true);

  v_res := jsonb_build_object(
    'ok', true, 'order_id', o.id, 'purchase_id', o.purchase_id, 'bookings', v_books,
    'requested', (select count(*) from jsonb_array_elements(v_books) b where b->>'status' = 'requested'),
    'totals', v_plan->'totals', 'setup_missing', v_plan->'setup_missing');
  return public.bk_remember(p_request_id, 'order_confirm', v_res);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Schedule more dates on an order: package sessions (consume the
--    package, no new charge) or more group dates (at the order's rate).
--    payload {dates:[iso], participant_ids?:[uuid], coach_id?, venue_space_id?,
--             override_availability?, override_reason?, notify?, dry_run?}
-- ---------------------------------------------------------------------------
create or replace function public.booking_order_add_dates(p_order uuid, p_payload jsonb, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  y      jsonb := coalesce(p_payload, '{}'::jsonb);
  v_org  uuid := public.current_org_id();
  v_rep  jsonb;
  o      public.booking_orders;
  x      jsonb;
  v_plan jsonb;
  v_dry  boolean := coalesce((y->>'dry_run')::boolean, false);
  v_books jsonb;
  v_res  jsonb;
  v_coach uuid;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if not v_dry then
    if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
    v_rep := public.bk_replay(p_request_id, 'order_add_dates');
    if v_rep is not null then return v_rep; end if;
    select * into o from public.booking_orders where id = p_order and org_id = v_org for update;
  else
    select * into o from public.booking_orders where id = p_order and org_id = v_org;
  end if;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  if o.status <> 'active' then raise exception 'ORDER_NOT_ACTIVE' using errcode = 'P0001'; end if;
  if o.option_kind = 'single' then raise exception 'ORDER_SINGLE_DATE' using errcode = 'P0001'; end if;
  if o.option_kind in ('package', 'existing_package') and o.purchase_id is null then
    raise exception 'PACKAGE_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  v_coach := coalesce(nullif(y->>'coach_id', '')::uuid, o.coach_id);

  x := jsonb_build_object(
    'service_id', o.service_id,
    'option', case when o.option_kind = 'group' then 'group' else 'existing_package' end,
    'purchase_id', o.purchase_id, 'agreed_rate', o.group_rate, 'fixed_rate', true,
    'coach_id', v_coach, 'venue_space_id', coalesce(nullif(y->>'venue_space_id', '')::uuid, o.venue_space_id),
    'dates', coalesce(y->'dates', '[]'::jsonb),
    'override_availability', coalesce((y->>'override_availability')::boolean, false),
    'override_reason', y->>'override_reason', 'notify', coalesce((y->>'notify')::boolean, true),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('athlete_id', bp.athlete_id, 'payer_id', bp.payer_id) order by bp.created_at)
                                from public.booking_order_participants bp
                               where bp.order_id = o.id and bp.status = 'active'
                                 and (coalesce(jsonb_typeof(y->'participant_ids'), 'null') <> 'array' or jsonb_array_length(y->'participant_ids') = 0
                                      or (y->'participant_ids') ? bp.id::text)), '[]'::jsonb));
  if jsonb_array_length(coalesce(y->'dates', '[]'::jsonb)) = 0 then raise exception 'DATES_REQUIRED' using errcode = 'P0001'; end if;

  if v_dry then
    return public.bko_plan(v_org, x);
  end if;

  if v_coach is not null then perform 1 from public.coaches where id = v_coach and org_id = v_org for update; end if;
  if o.purchase_id is not null then perform 1 from public.training_package_purchases where id = o.purchase_id for update; end if;
  v_plan := public.bko_plan(v_org, x);
  if jsonb_array_length(v_plan->'errors') > 0 then raise exception '%', v_plan->'errors'->>0 using errcode = 'P0001'; end if;
  if not (v_plan->>'dates_ok')::boolean then
    return jsonb_build_object('ok', false, 'code', 'DATES_UNAVAILABLE', 'dates', v_plan->'dates', 'replayed', false);
  end if;

  perform set_config('app.bk_internal', 'on', true);
  if v_coach is distinct from o.coach_id then
    o.coach_id := v_coach;   -- placement uses this coach (the order keeps its default)
  end if;
  o.venue_space_id := coalesce(nullif(y->>'venue_space_id', '')::uuid, o.venue_space_id);
  v_books := public.bko_place_all(v_org, o, v_plan, x, p_request_id, (v_plan->>'override')::boolean);
  perform set_config('app.bk_internal', '', true);
  v_res := jsonb_build_object('ok', true, 'order_id', o.id, 'bookings', v_books, 'totals', v_plan->'totals');
  return public.bk_remember(p_request_id, 'order_add_dates', v_res);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Invoices per payer. One or more orders of ONE revenue category (and
--    so one issuing entity) and one currency: one invoice per payer, one line
--    per athlete (+ the package line). Only uninvoiced, confirmed, billable
--    charges; requests wait for the coach. Idempotent with request_id.
-- ---------------------------------------------------------------------------
create or replace function public.booking_order_create_invoices(p_orders uuid[], p_request_id uuid, p_send boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_rep    jsonb;
  v_n      int;
  v_cat    text;
  v_cur    text;
  v_missing text[];
  v_lines  jsonb;
  g        record;
  l        jsonb;
  v_pay    jsonb;
  v_inv    uuid;
  v_num    text;
  v_item   uuid;
  v_total  numeric;
  v_fam    uuid;
  v_desc   text;
  v_label  text;
  v_due    int := (public.bk_settings(v_org)->>'invoice_due_days')::int;
  v_tz     text := public.ta_tz(v_org);
  v_out    jsonb := '[]'::jsonb;
  v_res    jsonb;
  v_ldesc  text;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  if p_orders is null or cardinality(p_orders) = 0 or cardinality(p_orders) > 50 then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  v_rep := public.bk_replay(p_request_id, 'order_invoice');
  if v_rep is not null then return v_rep; end if;

  perform 1 from public.booking_orders where id = any(p_orders) and org_id = v_org order by id for update;
  select count(*), min(billing_category), min(currency) into v_n, v_cat, v_cur
    from public.booking_orders where id = any(p_orders) and org_id = v_org;
  if v_n <> (select count(distinct u) from unnest(p_orders) u) then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  if (select count(distinct billing_category) from public.booking_orders where id = any(p_orders)) > 1 then
    raise exception 'CATEGORY_MIXED' using errcode = 'P0001';
  end if;
  if (select count(distinct currency) from public.booking_orders where id = any(p_orders)) > 1 then
    raise exception 'CURRENCY_MIXED' using errcode = 'P0001';
  end if;
  perform 1 from public.training_bookings where order_id = any(p_orders) order by id for update;

  -- Uninvoiced lines: the package sold by the order, and the confirmed
  -- billable bookings per participant and price.
  select coalesce(jsonb_agg(q order by q.sort_name, q.kind, q.first_at), '[]'::jsonb) into v_lines from (
    select 'package' as kind, o.id as order_id, bp.id as participant_id, bp.athlete_id, bp.payer_id, a.family_id,
           a.first_name || ' ' || a.last_name as athlete_name, a.last_name || ' ' || a.first_name as sort_name,
           ts.name as service_name, coalesce(cp.name, tp.sessions::text) as package_name,
           1 as qty, tp.amount as unit, tp.amount as amount, tp.id as purchase_id,
           '[]'::jsonb as booking_ids, null::text as dates, tp.created_at as first_at
      from public.booking_orders o
      join public.training_package_purchases tp on tp.id = o.purchase_id
      join public.booking_order_participants bp on bp.order_id = o.id and bp.athlete_id = tp.athlete_id
      join public.athletes a on a.id = bp.athlete_id
      join public.training_services ts on ts.id = o.service_id
      left join public.credit_packages cp on cp.id = tp.package_id
     where o.id = any(p_orders) and o.option_kind = 'package' and tp.invoice_id is null and tp.amount > 0 and tp.status <> 'cancelled'
    union all
    select 'sessions', o.id, bp.id, bp.athlete_id, bp.payer_id, a.family_id,
           a.first_name || ' ' || a.last_name, a.last_name || ' ' || a.first_name,
           ts.name, null, count(*)::int, b.price_chf, sum(b.price_chf), null::uuid,
           jsonb_agg(b.id order by b.slot_start),
           string_agg(to_char(b.slot_start at time zone v_tz, 'DD.MM.YYYY HH24:MI'), ', ' order by b.slot_start),
           min(b.slot_start)
      from public.training_bookings b
      join public.booking_orders o on o.id = b.order_id
      join public.booking_order_participants bp on bp.id = b.order_participant_id
      join public.athletes a on a.id = bp.athlete_id
      join public.training_services ts on ts.id = o.service_id
     where b.order_id = any(p_orders) and b.invoice_id is null and b.billing_mode = 'invoice'
       and b.status in ('booked', 'completed', 'no_show') and coalesce(b.price_chf, 0) > 0
     group by o.id, bp.id, bp.athlete_id, bp.payer_id, a.family_id, a.first_name, a.last_name, ts.name, b.price_chf) q;

  if jsonb_array_length(v_lines) = 0 then
    return public.bk_remember(p_request_id, 'order_invoice',
      jsonb_build_object('ok', true, 'invoices', '[]'::jsonb, 'nothing_to_invoice', true, 'category', v_cat));
  end if;
  v_missing := public.bko_setup_missing(v_org, v_cat);
  if cardinality(v_missing) > 0 then
    return jsonb_build_object('ok', false, 'code', 'SETUP_MISSING', 'setup_missing', to_jsonb(v_missing), 'replayed', false);
  end if;

  perform set_config('app.bk_internal', 'on', true);
  for g in
    select coalesce('payer:' || (l2->>'payer_id'), 'family:' || (l2->>'family_id')) as payer_key,
           min(l2->>'payer_id') as payer_id, min(l2->>'family_id') as family_id,
           jsonb_agg(l2 order by l2->>'sort_name', l2->>'kind', l2->>'first_at') as lines,
           count(distinct l2->>'athlete_id') as athletes, min(l2->>'athlete_id') as one_athlete,
           count(distinct l2->>'order_id') as orders, min(l2->>'order_id') as one_order
      from jsonb_array_elements(v_lines) l2
     group by 1
     order by 1
  loop
    v_pay := public.bk_payer_snapshot(v_org, g.payer_id::uuid, g.family_id::uuid);
    select coalesce(bp.family_id, g.family_id::uuid) into v_fam from (select 1) z
      left join public.billing_payers bp on bp.id = g.payer_id::uuid;
    if not exists (select 1 from public.families f where f.id = v_fam and f.org_id = v_org) then v_fam := g.family_id::uuid; end if;
    v_desc := case when g.orders = 1 then (select description from public.booking_orders where id = g.one_order::uuid) end;
    if v_desc is null then
      v_desc := left((select string_agg(distinct l3->>'service_name', ', ') from jsonb_array_elements(g.lines) l3) || ' — '
                     || (select string_agg(distinct l3->>'athlete_name', ', ') from jsonb_array_elements(g.lines) l3), 500);
    end if;
    v_label := left((select string_agg(distinct l3->>'service_name', ', ') from jsonb_array_elements(g.lines) l3) || ' · '
                    || to_char((select min((l3->>'first_at')::timestamptz) from jsonb_array_elements(g.lines) l3) at time zone v_tz, 'YYYY-MM-DD'), 200);

    insert into public.invoices (org_id, number, family_id, athlete_id, description, currency, status, due_date, created_by,
                                 activity, activity_source, payer_kind, payer_name, payer_profile_id, payer_id, payer_email,
                                 payer_address, source_label)
    values (v_org, public.next_invoice_number(v_org), v_fam, case when g.athletes = 1 then g.one_athlete::uuid end, v_desc, v_cur,
            case when coalesce(p_send, true) then 'sent' else 'draft' end::public.invoice_status,
            (public.ta_today(v_org) + v_due), auth.uid(),
            v_cat, 'set', v_pay->>'invoice_payer_kind', left(v_pay->>'name', 140),
            (v_pay->>'profile_id')::uuid, (v_pay->>'payer_id')::uuid, v_pay->>'email', v_pay->'address', v_label)
    returning id into v_inv;

    v_total := 0;
    for l in select e from jsonb_array_elements(g.lines) e loop
      if l->>'kind' = 'package' then
        v_ldesc := (l->>'service_name') || ' — ' || (l->>'package_name') || ' — ' || (l->>'athlete_name');
      else
        v_ldesc := (l->>'service_name') || ' — ' || (l->>'athlete_name') || ' — ' || (l->>'dates')
                   || ' (' || (l->>'qty') || ' × ' || trim(to_char((l->>'unit')::numeric, 'FM9999999990.00')) || ' ' || v_cur || ')';
      end if;
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (v_org, v_inv, left(v_ldesc, 500), (l->>'qty')::numeric, (l->>'unit')::numeric, (l->>'amount')::numeric)
      returning id into v_item;
      v_total := v_total + (l->>'amount')::numeric;
      if l->>'kind' = 'package' then
        update public.training_package_purchases set invoice_id = v_inv where id = (l->>'purchase_id')::uuid;
      else
        update public.training_bookings set invoice_id = v_inv, order_invoice_item_id = v_item
         where id in (select (j #>> '{}')::uuid from jsonb_array_elements(l->'booking_ids') j);
      end if;
    end loop;
    update public.invoices set total_chf = v_total where id = v_inv;
    perform set_config('app.billing_edit', 'on', true);
    update public.invoices set source_label = v_label where id = v_inv and source_label is distinct from v_label;
    perform set_config('app.billing_edit', 'off', true);

    select number into v_num from public.invoices where id = v_inv;
    v_out := v_out || (select jsonb_build_object('invoice_id', i.id, 'number', i.number, 'status', i.status, 'total', i.total_chf,
                                                 'currency', i.currency, 'payer_name', i.payer_name, 'payer_key', g.payer_key,
                                                 'lines', jsonb_array_length(g.lines), 'activity', i.activity,
                                                 'billing_entity_id', i.billing_entity_id)
                         from public.invoices i where i.id = v_inv);
  end loop;
  perform set_config('app.bk_internal', '', true);
  perform public.money_audit(v_org, 'BOOKING_ORDER_INVOICED', 'booking_orders', p_orders[1], null,
    jsonb_build_object('orders', to_jsonb(p_orders), 'invoices', v_out));
  v_res := jsonb_build_object('ok', true, 'invoices', v_out, 'category', v_cat, 'send', coalesce(p_send, true));
  return public.bk_remember(p_request_id, 'order_invoice', v_res);
end $$;

-- An invoice belongs to an order when it bills one of its bookings or its package.
create or replace function public.bko_invoice_of_order(p_order uuid, p_invoice uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.training_bookings b where b.order_id = p_order and b.invoice_id = p_invoice)
      or exists (select 1 from public.booking_orders o join public.training_package_purchases tp on tp.id = o.purchase_id
                  where o.id = p_order and o.option_kind = 'package' and tp.invoice_id = p_invoice);
$$;

-- Offline payment against one invoice of the order (receipt_record: idempotent with request_id).
create or replace function public.booking_order_record_payment(p_order uuid, p_invoice uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_req uuid := nullif(p_payload->>'request_id', '')::uuid; i public.invoices;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if v_req is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.booking_orders where id = p_order and org_id = public.current_org_id()) then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.bko_invoice_of_order(p_order, p_invoice) then raise exception 'NOT_INVOICED' using errcode = 'P0001'; end if;
  select * into i from public.invoices where id = p_invoice;
  return public.receipt_record(jsonb_build_object(
    'request_id', v_req, 'amount', p_payload->'amount', 'currency', i.currency,
    'received_on', p_payload->'received_on', 'method', coalesce(p_payload->>'method', 'bank_transfer'),
    'family_id', i.family_id, 'payer_name', i.payer_name,
    'reference', p_payload->'reference', 'note', p_payload->'note',
    'allocations', jsonb_build_array(jsonb_build_object('invoice_id', i.id, 'amount', p_payload->'amount'))));
end $$;

-- A draft order invoice: take the booking off its line (the draft is edited,
-- never an issued invoice); an emptied draft is cancelled.
create or replace function public.bko_draft_remove(p_booking uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare b public.training_bookings; i public.invoices; v_left numeric;
begin
  select * into b from public.training_bookings where id = p_booking;
  if b.invoice_id is null then return false; end if;
  select * into i from public.invoices where id = b.invoice_id for update;
  if i.status::text <> 'draft' then return false; end if;
  if b.order_invoice_item_id is not null then
    update public.invoice_items
       set quantity = quantity - 1, amount_chf = amount_chf - coalesce(b.price_chf, 0)
     where id = b.order_invoice_item_id;
    delete from public.invoice_items where id = b.order_invoice_item_id and (quantity <= 0 or amount_chf <= 0);
  end if;
  update public.invoices set total_chf = greatest(0, total_chf - coalesce(b.price_chf, 0)) where id = i.id
  returning total_chf into v_left;
  perform set_config('app.bk_internal', 'on', true);
  update public.training_bookings set invoice_id = null, order_invoice_item_id = null where id = b.id;
  if v_left <= 0 and not exists (select 1 from public.training_bookings x where x.invoice_id = i.id)
     and not exists (select 1 from public.training_package_purchases tp where tp.invoice_id = i.id) then
    perform public.cancel_invoice(i.id, 'booking order changed');
  end if;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 9. booking_cancel: + order bookings. A draft order invoice loses the
--    booking's line; "cancel_invoice" is refused when the invoice also bills
--    other bookings or a package (INVOICE_SHARED: use a credit note).
--    Otherwise unchanged (20250420104400).
-- ---------------------------------------------------------------------------
create or replace function public.booking_cancel(
  p_booking uuid, p_reason text, p_request_id uuid, p_refund_mode text default 'none',
  p_restore_package boolean default null, p_notify boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_rep    jsonb;
  b        public.training_bookings;
  e        public.training_booking_entitlements;
  v_set    jsonb;
  v_policy boolean;
  v_restore boolean := false;
  v_inv    public.invoices;
  v_paid   numeric;
  v_due    numeric;
  v_amt    numeric;
  v_money  jsonb;
  v_res    jsonb;
  v_mode   text := coalesce(nullif(p_refund_mode, ''), 'none');
  v_draft  boolean := false;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if length(p_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  if v_mode not in ('none', 'cancel_invoice', 'credit_note') then raise exception 'INVALID_REFUND_MODE' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'cancel');
  if v_rep is not null then return v_rep; end if;
  select * into b from public.training_bookings where id = p_booking and org_id = v_org for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  if b.status = 'cancelled' then raise exception 'ALREADY_CANCELLED' using errcode = 'P0001'; end if;
  if b.status <> 'booked' then raise exception 'BOOKING_NOT_CANCELLABLE' using errcode = 'P0001'; end if;
  if b.order_id is not null and b.invoice_id is not null and v_mode = 'cancel_invoice'
     and (exists (select 1 from public.training_bookings x where x.invoice_id = b.invoice_id and x.id <> b.id and x.status <> 'cancelled')
          or exists (select 1 from public.training_package_purchases tp where tp.invoice_id = b.invoice_id)) then
    raise exception 'INVOICE_SHARED' using errcode = 'P0001';
  end if;

  perform set_config('app.bk_internal', 'on', true);
  if b.order_id is not null and b.invoice_id is not null and v_mode <> 'none' then
    v_draft := public.bko_draft_remove(b.id);
    if v_draft then
      v_mode := 'none';
      select * into b from public.training_bookings where id = b.id;
    end if;
  end if;
  update public.training_bookings
     set status = 'cancelled', cancel_reason = btrim(p_reason), cancelled_at = now(), cancelled_by = auth.uid(),
         change_seq = change_seq + 1
   where id = b.id;
  perform public.bk_session_refresh(b.session_id);

  -- Package entitlement
  select * into e from public.training_booking_entitlements where booking_id = b.id for update;
  if e.id is not null and e.restored_at is null then
    v_set := public.bk_settings(v_org);
    v_policy := (v_set->>'refund_credits_on_cancel')::boolean
                and b.slot_start - now() >= make_interval(hours => (v_set->>'cancellation_hours')::numeric::int);
    v_restore := coalesce(p_restore_package, v_policy);
    if v_restore then
      update public.training_package_purchases set sessions_used = greatest(0, sessions_used - 1) where id = e.purchase_id;
      update public.training_booking_entitlements
         set restored_at = now(), restored_by = auth.uid(),
             restore_reason = case when p_restore_package is not null then 'staff' else 'policy' end
       where id = e.id;
    end if;
  end if;

  -- Invoice: issued invoices are never deleted
  if b.invoice_id is not null and v_mode <> 'none' then
    select * into v_inv from public.invoices where id = b.invoice_id;
    v_paid := public.invoice_net_paid(v_inv.id);
    v_due := v_inv.total_chf + v_inv.adjustments_total;
    if v_mode = 'cancel_invoice' or (v_mode = 'credit_note' and v_paid <= 0 and least(coalesce(b.price_chf, 0), v_due) >= v_due) then
      if v_inv.status::text not in ('cancelled', 'void') then
        v_money := public.cancel_invoice(v_inv.id, btrim(p_reason));
      end if;
    else
      v_amt := least(coalesce(b.price_chf, 0), v_due);
      if v_amt > 0 then
        v_money := public.issue_invoice_adjustment(v_inv.id, 'credit_note', v_amt, btrim(p_reason), null);
      end if;
    end if;
  end if;

  if coalesce(p_notify, true) then perform public.bk_enqueue_notifications(b.id, 'cancelled'); end if;
  perform set_config('app.bk_internal', '', true);
  v_res := jsonb_build_object('ok', true, 'booking_id', b.id, 'session_id', b.session_id,
                              'session_status', (select status from public.training_sessions where id = b.session_id),
                              'package_restored', v_restore, 'refund_mode', v_mode, 'invoice', v_money,
                              'draft_line_removed', v_draft,
                              'billing_status', public.booking_billing_status(b.id));
  return public.bk_remember(p_request_id, 'cancel', v_res);
end $$;

-- ---------------------------------------------------------------------------
-- 10. Partial changes of an order
--   booking_order_cancel(order, {scope: booking | participant | date,
--     booking_id? | participant_id? | session_id?, reason, refund_mode?
--     ('credit_note' default | 'none' = keep the charge), restore_package?,
--     notify?}, request_id)
--   booking_order_reschedule(order, {scope: booking | date, booking_id? |
--     session_id?, starts_at, coach_id?, venue_space_id?, price?,
--     price_reason?, override_availability?, override_reason?, notify?}, request_id)
-- ---------------------------------------------------------------------------
create or replace function public.booking_order_cancel(p_order uuid, p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  y       jsonb := coalesce(p_payload, '{}'::jsonb);
  v_org   uuid := public.current_org_id();
  v_rep   jsonb;
  o       public.booking_orders;
  v_scope text := coalesce(y->>'scope', '');
  v_reason text := btrim(coalesce(y->>'reason', ''));
  v_mode  text := coalesce(nullif(y->>'refund_mode', ''), 'credit_note');
  b       public.training_bookings;
  v_out   jsonb := '[]'::jsonb;
  v_r     jsonb;
  v_n     int := 0;
  v_res   jsonb;
  v_restored boolean;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  if v_reason = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  if v_scope not in ('booking', 'participant', 'date') then raise exception 'INVALID_SCOPE' using errcode = 'P0001'; end if;
  if v_mode not in ('credit_note', 'none') then raise exception 'INVALID_REFUND_MODE' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'order_cancel');
  if v_rep is not null then return v_rep; end if;
  select * into o from public.booking_orders where id = p_order and org_id = v_org for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  for b in
    select * from public.training_bookings x
     where x.order_id = o.id and x.status::text in ('booked', 'requested')
       and case v_scope
             when 'booking' then x.id = nullif(y->>'booking_id', '')::uuid
             when 'participant' then x.order_participant_id = nullif(y->>'participant_id', '')::uuid and x.slot_start >= now()
             else x.session_id = nullif(y->>'session_id', '')::uuid end
     order by x.slot_start, x.id
  loop
    v_n := v_n + 1;
    if b.status::text = 'requested' then
      -- A held place: released like a declined request (never invoiced).
      perform set_config('app.bk_internal', 'on', true);
      update public.training_bookings
         set status = 'cancelled', cancel_reason = v_reason, cancelled_at = now(), cancelled_by = auth.uid(),
             request_decision = 'declined', request_decided_at = now(), request_decided_by = auth.uid(),
             change_seq = change_seq + 1
       where id = b.id;
      v_restored := public.bk_release_request(b, 'declined');
      if coalesce((y->>'notify')::boolean, true) then perform public.bk_enqueue_notifications(b.id, 'request_declined'); end if;
      perform set_config('app.bk_internal', '', true);
      v_r := jsonb_build_object('ok', true, 'booking_id', b.id, 'package_restored', v_restored, 'request', true);
    else
      v_r := public.booking_cancel(b.id, v_reason, public.bko_sub_id(p_request_id, b.id::text, 'cancel'),
                                   case when b.invoice_id is not null then v_mode else 'none' end,
                                   case when y ? 'restore_package' and jsonb_typeof(y->'restore_package') = 'boolean'
                                        then (y->>'restore_package')::boolean end,
                                   coalesce((y->>'notify')::boolean, true));
    end if;
    v_out := v_out || (v_r || jsonb_build_object('athlete_id', b.athlete_id, 'starts_at', b.slot_start));
  end loop;
  if v_n = 0 then raise exception 'NOTHING_TO_CANCEL' using errcode = 'P0001'; end if;

  -- A player with nothing left (group / single) leaves the order; an order
  -- without active players (and without a package of its own) is cancelled.
  update public.booking_order_participants bp set status = 'cancelled', cancelled_at = now()
   where bp.order_id = o.id and bp.status = 'active' and o.option_kind in ('single', 'group')
     and not exists (select 1 from public.training_bookings x where x.order_participant_id = bp.id and x.status <> 'cancelled');
  if o.option_kind in ('single', 'group')
     and not exists (select 1 from public.booking_order_participants bp where bp.order_id = o.id and bp.status = 'active') then
    update public.booking_orders set status = 'cancelled', cancelled_at = now() where id = o.id;
  end if;
  perform public.money_audit(v_org, 'BOOKING_ORDER_CANCEL', 'booking_orders', o.id, null,
    jsonb_build_object('scope', v_scope, 'reason', v_reason, 'refund_mode', v_mode, 'bookings', v_n));
  v_res := jsonb_build_object('ok', true, 'order_id', o.id, 'cancelled', v_out,
                              'order_status', (select status from public.booking_orders where id = o.id));
  return public.bk_remember(p_request_id, 'order_cancel', v_res);
end $$;

create or replace function public.booking_order_reschedule(p_order uuid, p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  y       jsonb := coalesce(p_payload, '{}'::jsonb);
  v_org   uuid := public.current_org_id();
  v_rep   jsonb;
  o       public.booking_orders;
  v_scope text := coalesce(y->>'scope', '');
  b       public.training_bookings;
  v_out   jsonb := '[]'::jsonb;
  v_n     int := 0;
  v_res   jsonb;
  v_move  jsonb;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  if v_scope not in ('booking', 'date') then raise exception 'INVALID_SCOPE' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'order_reschedule');
  if v_rep is not null then return v_rep; end if;
  select * into o from public.booking_orders where id = p_order and org_id = v_org for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  v_move := y - 'scope' - 'booking_id' - 'session_id';

  for b in
    select * from public.training_bookings x
     where x.order_id = o.id and x.status = 'booked'
       and case v_scope when 'booking' then x.id = nullif(y->>'booking_id', '')::uuid
                        else x.session_id = nullif(y->>'session_id', '')::uuid end
     order by x.created_at, x.id
  loop
    v_n := v_n + 1;
    v_out := v_out || public.booking_reschedule(b.id, v_move, public.bko_sub_id(p_request_id, b.id::text, 'reschedule'));
  end loop;
  if v_n = 0 then raise exception 'NOTHING_TO_RESCHEDULE' using errcode = 'P0001'; end if;
  v_res := jsonb_build_object('ok', true, 'order_id', o.id, 'rescheduled', v_out);
  return public.bk_remember(p_request_id, 'order_reschedule', v_res);
end $$;

-- ---------------------------------------------------------------------------
-- 11. Reads
-- ---------------------------------------------------------------------------
create or replace function public.booking_order_detail(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare o public.booking_orders; v_tz text; tp public.training_package_purchases; v_inv jsonb; v_cur text;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into o from public.booking_orders where id = p_order and org_id = public.current_org_id();
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  v_tz := public.ta_tz(o.org_id);
  v_cur := o.currency;
  select * into tp from public.training_package_purchases where id = o.purchase_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'invoice_id', i.id, 'number', i.number, 'status', i.status, 'payer_name', i.payer_name, 'payer_kind', i.payer_kind,
           'currency', i.currency, 'total', i.total_chf, 'adjustments', i.adjustments_total,
           'due', i.total_chf + i.adjustments_total, 'paid', public.invoice_net_paid(i.id),
           'balance', case when i.status::text in ('cancelled', 'void', 'draft') then 0
                           else i.total_chf + i.adjustments_total - public.invoice_net_paid(i.id) end,
           'issued_at', i.issued_at, 'due_date', i.due_date, 'activity', i.activity,
           'other_orders', exists (select 1 from public.training_bookings x where x.invoice_id = i.id and x.order_id is distinct from o.id))
           order by i.created_at), '[]'::jsonb)
    into v_inv
    from public.invoices i
   where i.id in (select b.invoice_id from public.training_bookings b where b.order_id = o.id and b.invoice_id is not null
                  union select tp.invoice_id where o.option_kind = 'package' and tp.invoice_id is not null);

  return jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id, 'kind', o.kind, 'option_kind', o.option_kind, 'status', o.status, 'currency', o.currency,
      'service', (select jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'billing_category', s.billing_category,
                                            'short_description', s.short_description, 'duration_min', s.duration_min)
                    from public.training_services s where s.id = o.service_id),
      'coach', (select jsonb_build_object('id', c.id, 'display_name', c.display_name) from public.coaches c where c.id = o.coach_id),
      'venue_space_id', o.venue_space_id,
      'package_id', o.package_id, 'package_name', (select name from public.credit_packages where id = o.package_id),
      'option_sessions', o.option_sessions, 'list_total', o.list_total, 'agreed_total', o.agreed_total,
      'list_rate', o.list_rate, 'group_rate', o.group_rate, 'pricing_basis', o.pricing_basis,
      'price_override_reason', o.price_override_reason, 'billing_category', o.billing_category,
      'description', o.description, 'internal_notes', o.internal_notes, 'received_on', o.received_on,
      'created_at', o.created_at, 'created_by_name', (select full_name from public.profiles where id = o.created_by),
      'purchase_id', o.purchase_id, 'timezone', v_tz,
      'setup_missing', to_jsonb(public.bko_setup_missing(o.org_id, o.billing_category))),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'participant_id', bp.id, 'status', bp.status, 'rate', bp.rate, 'payer_id', bp.payer_id,
               'athlete', jsonb_build_object('id', a.id, 'first_name', a.first_name, 'last_name', a.last_name, 'family_id', a.family_id),
               'payer', public.bk_payer_snapshot(o.org_id, bp.payer_id, a.family_id),
               'sessions_booked', (select count(*) from public.training_bookings b where b.order_participant_id = bp.id and b.status = 'booked'),
               'sessions_requested', (select count(*) from public.training_bookings b where b.order_participant_id = bp.id and b.status::text = 'requested'),
               'sessions_completed', (select count(*) from public.training_bookings b where b.order_participant_id = bp.id and b.status in ('completed', 'no_show')),
               'sessions_cancelled', (select count(*) from public.training_bookings b where b.order_participant_id = bp.id and b.status = 'cancelled'),
               'charge', case when o.option_kind = 'package' then coalesce(tp.amount, 0)
                              when o.option_kind = 'existing_package' then 0
                              else coalesce((select sum(b.price_chf) from public.training_bookings b
                                              where b.order_participant_id = bp.id and b.billing_mode = 'invoice'
                                                and b.status in ('booked', 'completed', 'no_show')), 0) end,
               'invoiced', case when o.option_kind = 'package' then case when tp.invoice_id is not null then coalesce(tp.amount, 0) else 0 end
                                else coalesce((select sum(b.price_chf) from public.training_bookings b
                                                where b.order_participant_id = bp.id and b.invoice_id is not null
                                                  and b.status in ('booked', 'completed', 'no_show')), 0) end)
             order by a.last_name, a.first_name)
        from public.booking_order_participants bp join public.athletes a on a.id = bp.athlete_id
       where bp.order_id = o.id), '[]'::jsonb),
    'dates', coalesce((
      select jsonb_agg(d order by d->>'starts_at') from (
        select jsonb_build_object(
                 'session_id', b.session_id, 'starts_at', min(b.slot_start), 'ends_at', max(b.slot_end),
                 'coach_name', (select c.display_name from public.coaches c where c.id = min(b.coach_id::text)::uuid),
                 'session_status', (select s.status from public.training_sessions s where s.id = b.session_id),
                 'event_id', (select s.event_id from public.training_sessions s where s.id = b.session_id),
                 'capacity', (select s.capacity from public.training_sessions s where s.id = b.session_id),
                 'participants_count', case when b.session_id is not null then public.bk_session_count(b.session_id) end,
                 'location', min(coalesce((select v.name from public.venues v where v.id = b.venue_id), b.location_text)),
                 'bookings', jsonb_agg(jsonb_build_object(
                     'booking_id', b.id, 'participant_id', b.order_participant_id, 'athlete_id', b.athlete_id,
                     'first_name', a.first_name, 'last_name', a.last_name, 'status', b.status, 'starts_at', b.slot_start,
                     'billing_status', public.booking_billing_status(b.id), 'billing_mode', b.billing_mode, 'price', b.price_chf,
                     'invoice_id', b.invoice_id, 'invoice_number', (select number from public.invoices where id = b.invoice_id),
                     'cancel_reason', b.cancel_reason)
                   order by a.last_name, a.first_name)) d
          from public.training_bookings b join public.athletes a on a.id = b.athlete_id
         where b.order_id = o.id
         group by b.session_id, case when b.session_id is null then b.id end) q), '[]'::jsonb),
    'package', case when tp.id is not null then jsonb_build_object(
      'purchase_id', tp.id, 'sessions', tp.sessions, 'sessions_used', tp.sessions_used, 'status', tp.status,
      'expires_at', tp.expires_at, 'amount', tp.amount, 'invoice_id', tp.invoice_id, 'owned', o.option_kind = 'package',
      'invoice_number', (select number from public.invoices where id = tp.invoice_id),
      'booked', (select count(*) from public.training_bookings b where b.purchase_id = tp.id and b.status::text in ('booked', 'requested')),
      'completed', (select count(*) from public.training_bookings b where b.purchase_id = tp.id and b.status in ('completed', 'no_show')),
      'available', greatest(0, tp.sessions - tp.sessions_used)) end,
    'invoices', v_inv,
    'totals', jsonb_build_object(
      'currency', v_cur,
      'charged', case when o.option_kind = 'package' then coalesce(tp.amount, 0)
                      when o.option_kind = 'existing_package' then 0
                      else coalesce((select sum(b.price_chf) from public.training_bookings b
                                      where b.order_id = o.id and b.billing_mode = 'invoice' and b.status in ('booked', 'completed', 'no_show')), 0) end,
      'uninvoiced', case when o.option_kind = 'package' then case when tp.invoice_id is null then coalesce(tp.amount, 0) else 0 end
                         else coalesce((select sum(b.price_chf) from public.training_bookings b
                                         where b.order_id = o.id and b.billing_mode = 'invoice' and b.invoice_id is null
                                           and b.status in ('booked', 'completed', 'no_show')), 0) end,
      'invoiced', coalesce((select sum((j->>'due')::numeric) from jsonb_array_elements(v_inv) j where j->>'status' not in ('cancelled', 'void')), 0),
      'paid', coalesce((select sum((j->>'paid')::numeric) from jsonb_array_elements(v_inv) j), 0),
      'balance', coalesce((select sum((j->>'balance')::numeric) from jsonb_array_elements(v_inv) j), 0)),
    'can_add_dates', o.status = 'active' and o.option_kind in ('package', 'existing_package', 'group')
                     and (o.option_kind = 'group' or (tp.id is not null and tp.sessions > tp.sessions_used)));
end $$;

-- Orders with confirmed charges not yet invoiced (finance "To Invoice").
create or replace function public.booking_orders_to_invoice(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return coalesce((
    select jsonb_agg(r order by r->>'first_at') from (
      select jsonb_build_object(
               'order_id', o.id, 'service_id', o.service_id, 'service_name', ts.name, 'billing_category', o.billing_category,
               'currency', o.currency, 'option_kind', o.option_kind, 'received_on', o.received_on, 'created_at', o.created_at,
               'amount', u.amount, 'lines', u.lines, 'first_at', u.first_at,
               'athletes', (select jsonb_agg(a.first_name || ' ' || a.last_name order by a.last_name)
                              from public.booking_order_participants bp join public.athletes a on a.id = bp.athlete_id
                             where bp.order_id = o.id and bp.status = 'active'),
               'payers', (select count(distinct coalesce(bp.payer_id::text, a.family_id::text))
                            from public.booking_order_participants bp join public.athletes a on a.id = bp.athlete_id
                           where bp.order_id = o.id and bp.status = 'active'),
               'setup_missing', to_jsonb(public.bko_setup_missing(o.org_id, o.billing_category))) r
        from public.booking_orders o
        join public.training_services ts on ts.id = o.service_id
        join lateral (
          select sum(x.amount) amount, count(*) lines, min(x.at) first_at from (
            select b.price_chf amount, b.slot_start at from public.training_bookings b
             where b.order_id = o.id and b.invoice_id is null and b.billing_mode = 'invoice'
               and b.status in ('booked', 'completed', 'no_show') and coalesce(b.price_chf, 0) > 0
            union all
            select tp.amount, tp.created_at from public.training_package_purchases tp
             where tp.id = o.purchase_id and o.option_kind = 'package' and tp.invoice_id is null and tp.amount > 0
               and tp.status <> 'cancelled') x) u on u.lines > 0
       where o.org_id = v_org
       order by u.first_at
       limit greatest(1, least(coalesce(p_limit, 100), 500))) q), '[]'::jsonb);
end $$;

-- Single bookings to invoice: order bookings are invoiced with their order.
create or replace function public.bookings_to_invoice(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return coalesce((
    select jsonb_agg(public.bk_row(b) order by b.slot_start)
      from (select b.* from public.training_bookings b
             where b.org_id = public.current_org_id() and b.status in ('booked', 'completed', 'no_show')
               and b.invoice_id is null and coalesce(b.price_chf, 0) > 0 and b.order_id is null
               and coalesce(b.billing_mode, case when b.purchase_id is null and coalesce(b.credits_used, 0) = 0 then 'invoice' end) = 'invoice'
             order by b.slot_start
             limit greatest(1, least(coalesce(p_limit, 100), 500))) b), '[]'::jsonb);
end $$;

-- One invoice per single booking; order bookings are invoiced per payer on the order.
create or replace function public.booking_create_invoice(p_booking uuid, p_request_id uuid, p_send boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare b public.training_bookings; v_svc public.training_services; v_rep jsonb; v_missing text[]; v_res jsonb;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'invoice');
  if v_rep is not null then return v_rep; end if;
  select * into b from public.training_bookings where id = p_booking and org_id = public.current_org_id() for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  if b.invoice_id is not null then
    return jsonb_build_object('ok', true, 'invoice_id', b.invoice_id, 'already_invoiced', true, 'replayed', false,
                              'number', (select number from public.invoices where id = b.invoice_id));
  end if;
  if b.order_id is not null then raise exception 'ORDER_INVOICING' using errcode = 'P0001'; end if;
  if b.status::text = 'requested' then raise exception 'REQUEST_PENDING' using errcode = 'P0001'; end if;
  if b.status = 'cancelled' or coalesce(b.billing_mode, 'invoice') <> 'invoice' or coalesce(b.price_chf, 0) <= 0 then
    raise exception 'NOT_BILLABLE' using errcode = 'P0001';
  end if;
  select * into v_svc from public.training_services where id = b.service_id;
  v_missing := public.bk_setup_missing(v_svc);
  if cardinality(v_missing) > 0 then
    perform public.bk_flag(b.org_id, 'training_services', v_svc.id, 'SERVICE_BILLING_SETUP',
                           jsonb_build_object('missing', to_jsonb(v_missing), 'name', v_svc.name));
    return jsonb_build_object('ok', false, 'code', 'SETUP_MISSING', 'setup_missing', to_jsonb(v_missing));
  end if;
  v_res := public.bk_create_invoice(b.id, coalesce(p_send, false));
  perform set_config('app.bk_internal', '', true);
  return public.bk_remember(p_request_id, 'invoice', v_res);
end $$;

-- Booking row: + order_id (links the order from lists and detail).
create or replace function public.bk_row(b public.training_bookings)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'booking_id', b.id, 'status', b.status,
    'state', case b.status::text when 'booked' then 'confirmed' else b.status::text end,
    'billing_status', public.booking_billing_status(b.id), 'billing_mode', b.billing_mode,
    'slot_start', b.slot_start, 'slot_end', b.slot_end, 'created_via', b.created_via, 'created_at', b.created_at,
    'order_id', b.order_id,
    'service', jsonb_build_object('id', ts.id, 'name', ts.name, 'kind', ts.kind, 'billing_category', ts.billing_category),
    'coach', jsonb_build_object('id', c.id, 'display_name', c.display_name),
    'athlete', jsonb_build_object('id', a.id, 'first_name', a.first_name, 'last_name', a.last_name, 'family_id', a.family_id),
    'payer', case when b.payer_id is not null then jsonb_build_object('id', p.id, 'kind', p.kind, 'name', p.name) end,
    'session', case when s.id is not null then jsonb_build_object('id', s.id, 'event_id', s.event_id, 'status', s.status,
                                                                 'capacity', s.capacity, 'participants', public.bk_session_count(s.id),
                                                                 'rescheduled_from', s.rescheduled_from,
                                                                 'pending', public.bk_session_pending(s.id)) end,
    'location', coalesce((select v.name from public.venues v where v.id = b.venue_id), b.location_text),
    'price', b.price_chf, 'list_price', b.list_price, 'currency', coalesce(b.currency, i.currency, public.bk_currency(ts)),
    'price_override_reason', b.price_override_reason,
    'discount_total', b.discount_total, 'promo_code', b.promo_code,
    'invoice', case when i.id is not null then jsonb_build_object(
                 'id', i.id, 'number', i.number, 'status', i.status, 'due_date', i.due_date,
                 'total', i.total_chf + i.adjustments_total, 'paid', public.invoice_net_paid(i.id),
                 'balance', i.total_chf + i.adjustments_total - public.invoice_net_paid(i.id)) end,
    'warnings', b.warnings, 'cancel_reason', b.cancel_reason, 'cancelled_at', b.cancelled_at,
    'request', case when b.requested_at is not null then jsonb_build_object(
                 'source', b.request_source, 'requested_at', b.requested_at,
                 'requested_by_name', (select pf.full_name from public.profiles pf where pf.id = b.requested_by),
                 'decision', b.request_decision, 'decided_at', b.request_decided_at,
                 'decided_by_name', (select pf.full_name from public.profiles pf where pf.id = b.request_decided_by),
                 'stale', b.status::text = 'requested'
                          and b.requested_at < now() - make_interval(hours => (public.bk_settings(b.org_id)->>'request_followup_hours')::int)) end,
    'attendance_status', b.attendance_status)
    from public.training_services ts
    left join public.coaches c on c.id = b.coach_id
    left join public.athletes a on a.id = b.athlete_id
    left join public.billing_payers p on p.id = b.payer_id
    left join public.training_sessions s on s.id = b.session_id
    left join public.invoices i on i.id = b.invoice_id
   where ts.id = b.service_id;
$$;

-- Portals: + the invoice of a package sold by an order (booking_id null);
-- shared order invoices are listed once per booking (the UI de-duplicates).
create or replace function public.bk_portal_rows(p_athlete uuid, p_money boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'athlete', (select jsonb_build_object('id', a.id, 'first_name', a.first_name, 'last_name', a.last_name)
                  from public.athletes a where a.id = p_athlete),
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
               'booking_id', b.id, 'service_name', ts.name, 'kind', ts.kind, 'coach_name', c.display_name,
               'starts_at', b.slot_start, 'ends_at', b.slot_end, 'status', b.status,
               'awaiting_confirmation', b.status::text = 'requested',
               'can_withdraw', p_money and b.status::text = 'requested' and b.request_source = 'family',
               'requested_at', b.requested_at,
               'event_id', s.event_id,
               'can_report_absence', b.status::text = 'booked' and b.slot_start > now() and s.event_id is not null
                                     and coalesce(s.status, 'scheduled') = 'scheduled',
               'absence_report', (select jsonb_build_object('report_id', r.id, 'status', r.status, 'reason_category', r.reason_category)
                                    from public.team_absence_reports r
                                   where r.event_id = s.event_id and r.athlete_id = b.athlete_id and r.status in ('reported', 'acknowledged')
                                   limit 1),
               'rescheduled_from', s.rescheduled_from, 'rescheduled_at', b.rescheduled_at,
               'location', coalesce((select v.name from public.venues v where v.id = b.venue_id), b.location_text))
             order by b.slot_start)
        from public.training_bookings b
        join public.training_services ts on ts.id = b.service_id
        left join public.coaches c on c.id = b.coach_id
        left join public.training_sessions s on s.id = b.session_id
       where b.athlete_id = p_athlete and b.status::text in ('booked', 'requested')
         and coalesce(b.slot_end, b.slot_start) >= now()), '[]'::jsonb),
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object('booking_id', b.id, 'service_name', ts.name, 'coach_name', c.display_name,
                                          'starts_at', b.slot_start, 'ends_at', b.slot_end,
                                          'change', case when b.request_decision = 'declined' then 'declined'
                                                         when b.request_decision = 'withdrawn' then 'withdrawn'
                                                         when b.status = 'cancelled' then 'cancelled' else 'rescheduled' end,
                                          'reason', case when b.status = 'cancelled' then b.cancel_reason end,
                                          'previous_starts_at', case when b.status <> 'cancelled' then s.rescheduled_from end,
                                          'at', coalesce(b.cancelled_at, b.rescheduled_at))
             order by coalesce(b.cancelled_at, b.rescheduled_at) desc)
        from public.training_bookings b
        join public.training_services ts on ts.id = b.service_id
        left join public.coaches c on c.id = b.coach_id
        left join public.training_sessions s on s.id = b.session_id
       where b.athlete_id = p_athlete
         and ((b.status = 'cancelled' and b.cancelled_at >= now() - interval '30 days')
              or (b.status <> 'cancelled' and b.rescheduled_at is not null and b.rescheduled_at >= now() - interval '30 days'))), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', e.id, 'service_name', ts.name, 'coach_name', c.display_name,
                                          'starts_at', e.starts_at, 'status', m.finalized_status,
                                          'booking_status', (select bb.status from public.training_bookings bb
                                                              where bb.session_id = s.id and bb.athlete_id = p_athlete
                                                                and bb.status <> 'cancelled' limit 1))
             order by e.starts_at desc)
        from public.team_attendance_marks m
        join public.team_attendance_sheets sh on sh.id = m.sheet_id and sh.finalize_count > 0
        join public.events e on e.id = m.event_id and e.training_session_id is not null
        join public.training_sessions s on s.id = e.training_session_id
        join public.training_services ts on ts.id = s.service_id
        left join public.coaches c on c.id = s.coach_id
       where m.athlete_id = p_athlete and m.finalized_status is not null), '[]'::jsonb),
    'invoices', case when p_money then coalesce((
      select jsonb_agg(q.j order by q.issued_at desc) from (
        select i.issued_at, jsonb_build_object('invoice_id', i.id, 'number', i.number, 'status', i.status, 'due_date', i.due_date,
                                               'currency', i.currency, 'total', i.total_chf + i.adjustments_total,
                                               'balance', i.total_chf + i.adjustments_total - public.invoice_net_paid(i.id),
                                               'booking_id', b.id, 'service_name', ts.name, 'starts_at', b.slot_start) j
          from public.training_bookings b
          join public.invoices i on i.id = b.invoice_id
          join public.training_services ts on ts.id = b.service_id
         where b.athlete_id = p_athlete and public.bk_guardian_sees_invoice(i.id)
        union all
        select i.issued_at, jsonb_build_object('invoice_id', i.id, 'number', i.number, 'status', i.status, 'due_date', i.due_date,
                                               'currency', i.currency, 'total', i.total_chf + i.adjustments_total,
                                               'balance', i.total_chf + i.adjustments_total - public.invoice_net_paid(i.id),
                                               'booking_id', null, 'service_name', ts.name, 'starts_at', null)
          from public.booking_orders o
          join public.training_package_purchases tp on tp.id = o.purchase_id
          join public.invoices i on i.id = tp.invoice_id
          join public.training_services ts on ts.id = o.service_id
         where o.option_kind = 'package' and tp.athlete_id = p_athlete and public.bk_guardian_sees_invoice(i.id)) q), '[]'::jsonb)
      else '[]'::jsonb end);
$$;

-- ---------------------------------------------------------------------------
-- 12. Privileges
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.bko_options(public.training_services)', 'public.bko_pricing_missing(public.training_services)',
    'public.bko_setup_missing(uuid, text)', 'public.bko_sub_id(uuid, text, text)', 'public.bko_plan(uuid, jsonb)',
    'public.bko_place_all(uuid, public.booking_orders, jsonb, jsonb, uuid, boolean)',
    'public.bko_invoice_of_order(uuid, uuid)', 'public.bko_draft_remove(uuid)',
    'public.bk_row(public.training_bookings)', 'public.bk_portal_rows(uuid, boolean)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;

  foreach f in array array[
    'public.training_service_catalog(boolean)', 'public.service_pricing_save(uuid, jsonb)',
    'public.booking_order_quote(jsonb)', 'public.booking_order_confirm(jsonb, uuid)',
    'public.booking_order_add_dates(uuid, jsonb, uuid)', 'public.booking_order_create_invoices(uuid[], uuid, boolean)',
    'public.booking_order_record_payment(uuid, uuid, jsonb)', 'public.booking_order_cancel(uuid, jsonb, uuid)',
    'public.booking_order_reschedule(uuid, jsonb, uuid)', 'public.booking_order_detail(uuid)',
    'public.booking_orders_to_invoice(integer)', 'public.bookings_to_invoice(integer)',
    'public.booking_create_invoice(uuid, uuid, boolean)',
    'public.booking_cancel(uuid, text, uuid, text, boolean, boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
